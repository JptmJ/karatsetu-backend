/** Turns TableDef objects into the SQL text Postgres wants. */
import type { CheckDef, ColumnDef, IndexDef, ResolvedTable, UniqueDef } from './types.js';

export const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** Postgres truncates identifiers at 63 bytes, so we do it ourselves and keep it deterministic. */
export function boundedName(parts: string[], prefix: string): string {
  const raw = `${prefix}_${parts.join('_')}`;
  if (raw.length <= 63) return raw;
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
  return `${raw.slice(0, 54)}_${hash.toString(36)}`;
}

export const indexName = (table: string, ix: IndexDef): string =>
  ix.name ?? boundedName([table, ...ix.columns], ix.unique ? 'ux' : 'ix');

export const uniqueName = (table: string, u: UniqueDef): string =>
  u.name ?? boundedName([table, ...u.columns], 'uq');

export const fkName = (table: string, column: string): string => boundedName([table, column], 'fk');

export const checkName = (table: string, c: CheckDef): string => boundedName([table, c.name], 'ck');

export const pkName = (table: string): string => boundedName([table], 'pk');

export const policyName = (table: string, suffix: string): string =>
  boundedName([table, suffix], 'rls');

export function columnClause(name: string, def: ColumnDef): string {
  const bits = [quoteIdent(name), def.type];
  if (def.notNull) bits.push('not null');
  if (def.default !== undefined) bits.push(`default ${def.default}`);
  return bits.join(' ');
}

export function columnCheckExpression(name: string, def: ColumnDef): string | null {
  if (!def.check) return null;
  return def.check.replaceAll('{col}', quoteIdent(name));
}

export function createTableSql(t: ResolvedTable): string[] {
  const lines: string[] = [];
  for (const [name, def] of Object.entries(t.columns)) lines.push(columnClause(name, def));
  lines.push(`constraint ${quoteIdent(pkName(t.name))} primary key (${quoteIdent('id')})`);

  const statements = [
    `create table ${quoteIdent(t.name)} (\n  ${lines.join(',\n  ')}\n)`,
  ];

  for (const [name, def] of Object.entries(t.columns)) {
    const expr = columnCheckExpression(name, def);
    if (expr) {
      statements.push(
        `alter table ${quoteIdent(t.name)} add constraint ${quoteIdent(
          boundedName([t.name, name], 'ck'),
        )} check (${expr})`,
      );
    }
  }
  for (const c of t.checks) {
    statements.push(
      `alter table ${quoteIdent(t.name)} add constraint ${quoteIdent(checkName(t.name, c))} check (${c.expression})`,
    );
  }
  return statements;
}

export function foreignKeySql(table: string, column: string, def: ColumnDef): string | null {
  const fk = def.references;
  if (!fk) return null;
  const target = fk.column ?? 'id';
  const parts = [
    `alter table ${quoteIdent(table)} add constraint ${quoteIdent(fkName(table, column))}`,
    `foreign key (${quoteIdent(column)}) references ${quoteIdent(fk.table)} (${quoteIdent(target)})`,
  ];
  if (fk.onDelete) parts.push(`on delete ${fk.onDelete}`);
  if (fk.onUpdate) parts.push(`on update ${fk.onUpdate}`);
  return parts.join(' ');
}

export function createIndexSql(table: string, ix: IndexDef): string {
  const parts = [
    `create${ix.unique ? ' unique' : ''} index ${quoteIdent(indexName(table, ix))}`,
    `on ${quoteIdent(table)}`,
  ];
  if (ix.method && ix.method !== 'btree') parts.push(`using ${ix.method}`);
  parts.push(`(${ix.columns.map(quoteIdent).join(', ')})`);
  if (ix.where) parts.push(`where ${ix.where}`);
  return parts.join(' ');
}

export function uniqueSql(table: string, u: UniqueDef): string {
  const nulls = u.nullsNotDistinct ? ' nulls not distinct' : '';
  return `alter table ${quoteIdent(table)} add constraint ${quoteIdent(uniqueName(table, u))} unique${nulls} (${u.columns
    .map(quoteIdent)
    .join(', ')})`;
}

/**
 * Row Level Security. Two policies, OR'd together by Postgres:
 *   1. normal traffic  — only rows matching the tenant on the connection
 *   2. platform tasks  — an explicit, deliberately awkward opt-out
 *
 * FORCE matters: without it the table owner (which is the app's own role,
 * because the app creates the tables) would quietly bypass every policy.
 */
export function rlsSql(table: string): string[] {
  return [
    `alter table ${quoteIdent(table)} enable row level security`,
    `alter table ${quoteIdent(table)} force row level security`,
    `create policy ${quoteIdent(policyName(table, 'tenant'))} on ${quoteIdent(table)}
       using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
       with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)`,
    `create policy ${quoteIdent(policyName(table, 'platform'))} on ${quoteIdent(table)}
       using (current_setting('app.bypass_rls', true) = 'on')
       with check (current_setting('app.bypass_rls', true) = 'on')`,
  ];
}
