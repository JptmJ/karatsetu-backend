/**
 * Compares "what the code says the DB should be" against "what the DB is", and
 * produces a list of changes, each tagged with how dangerous it is.
 *
 * The rule that keeps this safe to run on every boot: adding things is
 * automatic, removing or rewriting things is not.
 */
import type { LiveSchema, ResolvedTable, SchemaChange } from './types.js';
import { tablesInDependencyOrder } from './registry.js';
import { normaliseDefault } from './introspect.js';
import {
  boundedName,
  checkName,
  columnCheckExpression,
  columnClause,
  createIndexSql,
  createTableSql,
  fkName,
  foreignKeySql,
  indexName,
  policyName,
  quoteIdent,
  rlsSql,
  uniqueName,
  uniqueSql,
} from './sql.js';

/**
 * Widening a numeric column (more digits, same or more decimals) is safe —
 * every existing value still fits. Narrowing is not.
 */
function numericChange(from: string, to: string): 'widen' | 'narrow' | 'same' | 'unrelated' {
  const parse = (t: string): [number, number] | null => {
    const m = /^numeric\((\d+),(\d+)\)$/.exec(t);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return 'unrelated';
  if (a[0] === b[0] && a[1] === b[1]) return 'same';
  // Integer digits available on each side.
  const aInt = a[0] - a[1];
  const bInt = b[0] - b[1];
  return bInt >= aInt && b[1] >= a[1] ? 'widen' : 'narrow';
}

/** Columns the app manages but should never auto-drop if they linger in the DB. */
const NEVER_AUTO_DROP = new Set(['id', 'tenant_id', 'created_at', 'updated_at']);

export function diffSchema(live: LiveSchema, desired = tablesInDependencyOrder()): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const desiredNames = new Set(desired.map((t) => t.name));

  for (const table of desired) {
    const current = live.get(table.name);
    if (!current) {
      changes.push({
        kind: 'create_table',
        risk: 'safe',
        table: table.name,
        description: `create table ${table.name} (${Object.keys(table.columns).length} columns)`,
        sql: createTableSql(table),
      });
      // A brand-new table still needs its FKs, indexes, uniques and RLS, which
      // are emitted below by treating it as "empty" rather than "absent".
      diffTableInternals(table, undefined, changes);
      continue;
    }
    diffColumns(table, current, changes);
    diffTableInternals(table, current, changes);
    diffDroppedColumns(table, current, changes);
  }

  // Tables in the DB that the code no longer knows about. Never automatic —
  // it is nearly always an old module or a rename, and both want a human.
  for (const [name] of live) {
    if (desiredNames.has(name) || name.startsWith('_')) continue;
    changes.push({
      kind: 'drop_table',
      risk: 'destructive',
      table: name,
      description: `table ${name} exists in the database but no module defines it`,
      sql: [`drop table ${quoteIdent(name)}`],
      blockedReason: 'Unknown table — could be a renamed table or a rolled-back module.',
    });
  }

  return changes;
}

function diffColumns(table: ResolvedTable, current: LiveSchema extends Map<string, infer T> ? T : never, changes: SchemaChange[]): void {
  for (const [name, def] of Object.entries(table.columns)) {
    const liveCol = current.columns.get(name);

    if (!liveCol) {
      // Adding a NOT NULL column to a table that may already hold rows only
      // works if there is a default to backfill with.
      const needsBackfill = def.notNull && def.default === undefined;
      changes.push({
        kind: 'add_column',
        risk: needsBackfill ? 'warn' : 'safe',
        table: table.name,
        object: name,
        description: `add column ${table.name}.${name} ${def.type}${def.notNull ? ' not null' : ''}`,
        sql: [`alter table ${quoteIdent(table.name)} add column ${columnClause(name, def)}`],
        ...(needsBackfill
          ? {
              blockedReason:
                'NOT NULL column with no default cannot be added to a table that may contain rows. Give it a default, or add it nullable first.',
            }
          : {}),
      });
      continue;
    }

    if (liveCol.type !== def.type) {
      const verdict = numericChange(liveCol.type, def.type);
      const destructive = verdict === 'narrow' || verdict === 'unrelated';
      changes.push({
        kind: 'alter_column_type',
        risk: destructive ? 'destructive' : 'warn',
        table: table.name,
        object: name,
        description: `change ${table.name}.${name} from ${liveCol.type} to ${def.type}`,
        sql: [
          `alter table ${quoteIdent(table.name)} alter column ${quoteIdent(name)} type ${def.type} using ${quoteIdent(name)}::${def.type}`,
        ],
        ...(destructive
          ? { blockedReason: `Type change ${liveCol.type} -> ${def.type} can truncate or fail on existing rows.` }
          : {}),
      });
    }

    if (def.notNull && !liveCol.notNull) {
      changes.push({
        kind: 'set_not_null',
        risk: 'warn',
        table: table.name,
        object: name,
        description: `make ${table.name}.${name} NOT NULL`,
        sql: [`alter table ${quoteIdent(table.name)} alter column ${quoteIdent(name)} set not null`],
        blockedReason: 'Fails if any existing row holds NULL in this column. Backfill first.',
      });
    }

    if (!def.notNull && liveCol.notNull) {
      changes.push({
        kind: 'drop_not_null',
        risk: 'safe',
        table: table.name,
        object: name,
        description: `allow NULL in ${table.name}.${name}`,
        sql: [`alter table ${quoteIdent(table.name)} alter column ${quoteIdent(name)} drop not null`],
      });
    }

    // Compare both sides through the same normaliser. Postgres reports a
    // default as `'{}'::jsonb` while the model writes `'{}'`, and without this
    // every boot would think the default had changed and rewrite it forever.
    const wantDefault = def.default ?? null;
    if (normaliseDefault(wantDefault) !== normaliseDefault(liveCol.default)) {
      if (wantDefault === null) {
        changes.push({
          kind: 'drop_default',
          risk: 'safe',
          table: table.name,
          object: name,
          description: `drop default on ${table.name}.${name}`,
          sql: [`alter table ${quoteIdent(table.name)} alter column ${quoteIdent(name)} drop default`],
        });
      } else {
        changes.push({
          kind: 'set_default',
          risk: 'safe',
          table: table.name,
          object: name,
          description: `set default on ${table.name}.${name} to ${wantDefault}`,
          sql: [
            `alter table ${quoteIdent(table.name)} alter column ${quoteIdent(name)} set default ${wantDefault}`,
          ],
        });
      }
    }
  }
}

function diffDroppedColumns(
  table: ResolvedTable,
  current: LiveSchema extends Map<string, infer T> ? T : never,
  changes: SchemaChange[],
): void {
  for (const [name] of current.columns) {
    if (name in table.columns || NEVER_AUTO_DROP.has(name)) continue;
    changes.push({
      kind: 'drop_column',
      risk: 'destructive',
      table: table.name,
      object: name,
      description: `column ${table.name}.${name} exists in the database but not in the model`,
      sql: [`alter table ${quoteIdent(table.name)} drop column ${quoteIdent(name)}`],
      blockedReason: 'Dropping a column destroys its data permanently.',
    });
  }
}

/** FKs, uniques, checks, indexes and RLS — the parts that live outside CREATE TABLE. */
function diffTableInternals(
  table: ResolvedTable,
  current: (LiveSchema extends Map<string, infer T> ? T : never) | undefined,
  changes: SchemaChange[],
): void {
  const constraints = current?.constraints ?? new Map();
  const indexes = current?.indexes ?? new Map();
  const isNew = current === undefined;

  const wantedConstraints = new Set<string>();
  const wantedIndexes = new Set<string>();

  for (const [name, def] of Object.entries(table.columns)) {
    const fkSql = foreignKeySql(table.name, name, def);
    if (fkSql) {
      const cname = fkName(table.name, name);
      wantedConstraints.add(cname);
      if (!constraints.has(cname)) {
        changes.push({
          kind: 'add_constraint',
          risk: 'warn',
          table: table.name,
          object: cname,
          description: `link ${table.name}.${name} -> ${def.references!.table}`,
          sql: [fkSql],
        });
      }
    }

    if (!isNew) {
      const expr = columnCheckExpression(name, def);
      if (expr) {
        const cname = boundedName([table.name, name], 'ck');
        wantedConstraints.add(cname);
        if (!constraints.has(cname)) {
          changes.push({
            kind: 'add_constraint',
            risk: 'warn',
            table: table.name,
            object: cname,
            description: `add value check on ${table.name}.${name}`,
            sql: [
              `alter table ${quoteIdent(table.name)} add constraint ${quoteIdent(cname)} check (${expr})`,
            ],
          });
        }
      }
    } else {
      const expr = columnCheckExpression(name, def);
      if (expr) wantedConstraints.add(boundedName([table.name, name], 'ck'));
    }
  }

  for (const c of table.checks) {
    const cname = checkName(table.name, c);
    wantedConstraints.add(cname);
    if (!isNew && !constraints.has(cname)) {
      changes.push({
        kind: 'add_constraint',
        risk: 'warn',
        table: table.name,
        object: cname,
        description: `add rule ${cname} on ${table.name}`,
        sql: [
          `alter table ${quoteIdent(table.name)} add constraint ${quoteIdent(cname)} check (${c.expression})`,
        ],
      });
    }
  }

  for (const u of table.uniques) {
    const cname = uniqueName(table.name, u);
    wantedConstraints.add(cname);
    wantedIndexes.add(cname);
    if (!constraints.has(cname)) {
      changes.push({
        kind: 'add_constraint',
        risk: 'warn',
        table: table.name,
        object: cname,
        description: `make ${u.columns.join(' + ')} unique on ${table.name}`,
        sql: [uniqueSql(table.name, u)],
      });
    }
  }

  for (const ix of table.indexes) {
    const iname = indexName(table.name, ix);
    wantedIndexes.add(iname);
    if (!indexes.has(iname)) {
      changes.push({
        kind: 'create_index',
        risk: 'safe',
        table: table.name,
        object: iname,
        description: `index ${table.name} (${ix.columns.join(', ')})`,
        sql: [createIndexSql(table.name, ix)],
      });
    }
  }

  // Indexes we no longer want. Dropping an index loses no data, but it can
  // wreck query plans, so it stays a deliberate decision.
  for (const [iname, ix] of indexes) {
    if (wantedIndexes.has(iname) || ix.isConstraintBacked) continue;
    if (constraints.has(iname)) continue;
    changes.push({
      kind: 'drop_index',
      risk: 'warn',
      table: table.name,
      object: iname,
      description: `index ${iname} exists but is not in the model`,
      sql: [`drop index ${quoteIdent(iname)}`],
      blockedReason: 'Unknown index — may have been added by hand to fix a slow query.',
    });
  }

  // Row Level Security.
  if (table.tenantScoped) {
    const needsRls = isNew || !current!.rlsEnabled || !current!.rlsForced;
    const missingPolicies =
      isNew ||
      !current!.policies.has(policyName(table.name, 'tenant')) ||
      !current!.policies.has(policyName(table.name, 'platform'));

    if (needsRls || missingPolicies) {
      const statements = rlsSql(table.name).filter((s) => {
        if (isNew) return true;
        if (s.includes('enable row level security')) return !current!.rlsEnabled;
        if (s.includes('force row level security')) return !current!.rlsForced;
        if (s.includes(policyName(table.name, 'tenant'))) {
          return !current!.policies.has(policyName(table.name, 'tenant'));
        }
        return !current!.policies.has(policyName(table.name, 'platform'));
      });
      if (statements.length) {
        changes.push({
          kind: 'enable_rls',
          risk: 'safe',
          table: table.name,
          description: `turn on tenant isolation for ${table.name}`,
          sql: statements,
        });
      }
    }
  }
}
