import { beforeEach, describe, expect, it } from 'vitest';
import { clearRegistry, defineTable, tablesInDependencyOrder } from '../src/core/db/schema/registry.js';
import { col } from '../src/core/db/schema/columns.js';
import { diffSchema } from '../src/core/db/schema/diff.js';
import { normaliseDefault, normaliseType } from '../src/core/db/schema/introspect.js';
import type { LiveSchema, LiveTable } from '../src/core/db/schema/types.js';

/** Builds a fake "what the database looks like" for the diff to compare against. */
function liveTable(name: string, columns: Record<string, { type: string; notNull?: boolean; default?: string | null }>): LiveTable {
  return {
    name,
    columns: new Map(
      Object.entries(columns).map(([c, d]) => [
        c,
        { name: c, type: d.type, notNull: d.notNull ?? false, default: d.default ?? null },
      ]),
    ),
    constraints: new Map(),
    indexes: new Map(),
    rlsEnabled: true,
    rlsForced: true,
    policies: new Set([`rls_${name}_tenant`, `rls_${name}_platform`]),
  };
}

beforeEach(clearRegistry);

describe('schema diff safety rules', () => {
  it('creates a table that does not exist yet, and calls it safe', () => {
    defineTable({ name: 'widget', module: 'test', columns: { name: col.text({ notNull: true }) } });
    const changes = diffSchema(new Map() as LiveSchema);
    const create = changes.find((c) => c.kind === 'create_table');
    expect(create?.risk).toBe('safe');
    expect(create?.sql[0]).toContain('create table "widget"');
  });

  it('adds a nullable column automatically but blocks a NOT NULL one with no default', () => {
    defineTable({
      name: 'widget',
      module: 'test',
      timestamps: false,
      tenantScoped: false,
      columns: {
        optional: col.text(),
        required: col.text({ notNull: true }),
        defaulted: col.text({ notNull: true, default: "'x'" }),
      },
    });

    const live: LiveSchema = new Map([['widget', liveTable('widget', { id: { type: 'uuid', notNull: true } })]]);
    const changes = diffSchema(live);
    const byColumn = new Map(changes.filter((c) => c.kind === 'add_column').map((c) => [c.object, c]));

    expect(byColumn.get('optional')?.risk).toBe('safe');
    expect(byColumn.get('required')?.risk).toBe('warn');
    expect(byColumn.get('required')?.blockedReason).toBeTruthy();
    expect(byColumn.get('defaulted')?.risk).toBe('safe');
  });

  it('never drops a column or a table on its own', () => {
    defineTable({ name: 'widget', module: 'test', timestamps: false, tenantScoped: false, columns: {} });

    const live: LiveSchema = new Map([
      ['widget', liveTable('widget', { id: { type: 'uuid', notNull: true }, old_field: { type: 'text' } })],
      ['forgotten_table', liveTable('forgotten_table', { id: { type: 'uuid' } })],
    ]);

    const changes = diffSchema(live);
    const dropColumn = changes.find((c) => c.kind === 'drop_column');
    const dropTable = changes.find((c) => c.kind === 'drop_table');

    expect(dropColumn?.risk).toBe('destructive');
    expect(dropColumn?.blockedReason).toBeTruthy();
    expect(dropTable?.risk).toBe('destructive');
    expect(dropTable?.blockedReason).toBeTruthy();
  });

  it('allows widening a numeric column but blocks narrowing it', () => {
    defineTable({
      name: 'widget', module: 'test', timestamps: false, tenantScoped: false,
      columns: { amount: col.numeric(20, 4) },
    });
    const widening: LiveSchema = new Map([
      ['widget', liveTable('widget', { id: { type: 'uuid' }, amount: { type: 'numeric(12,4)' } })],
    ]);
    expect(diffSchema(widening).find((c) => c.kind === 'alter_column_type')?.risk).toBe('warn');

    clearRegistry();
    defineTable({
      name: 'widget', module: 'test', timestamps: false, tenantScoped: false,
      columns: { amount: col.numeric(8, 2) },
    });
    const narrowing: LiveSchema = new Map([
      ['widget', liveTable('widget', { id: { type: 'uuid' }, amount: { type: 'numeric(20,4)' } })],
    ]);
    const change = diffSchema(narrowing).find((c) => c.kind === 'alter_column_type');
    expect(change?.risk).toBe('destructive');
    expect(change?.blockedReason).toBeTruthy();
  });

  it('reports nothing when the database already matches — the boot-time no-op', () => {
    defineTable({
      name: 'widget', module: 'test', timestamps: false, tenantScoped: false,
      columns: { name: col.text({ notNull: true }), meta: col.jsonb({ notNull: true, default: "'{}'::jsonb" }) },
    });

    const live: LiveSchema = new Map([
      ['widget', liveTable('widget', {
        id: { type: 'uuid', notNull: true },
        name: { type: 'text', notNull: true },
        // Postgres reports the jsonb default with its cast stripped by the introspector.
        meta: { type: 'jsonb', notNull: true, default: "'{}'" },
      })],
    ]);
    live.get('widget')!.constraints.set('pk_widget', { name: 'pk_widget', kind: 'p', definition: 'PRIMARY KEY (id)' });

    expect(diffSchema(live)).toEqual([]);
  });

  it('gives every tenant table a tenant_id, a tenant index and RLS without being asked', () => {
    const widget = defineTable({ name: 'widget', module: 'test', columns: { name: col.text() } });
    expect(widget.columns.tenant_id).toBeDefined();
    expect(widget.indexes[0]?.columns).toEqual(['tenant_id']);

    const changes = diffSchema(new Map() as LiveSchema);
    expect(changes.find((c) => c.kind === 'enable_rls')).toBeDefined();
  });

  it('forces tenant_id into any unique constraint on a tenant table', () => {
    const widget = defineTable({
      name: 'widget', module: 'test',
      columns: { code: col.text({ notNull: true }) },
      uniques: [{ columns: ['code'] }],
    });
    // Without this, the first tenant to use code "INV-001" would lock every
    // other tenant out of that code forever.
    expect(widget.uniques[0]?.columns).toEqual(['tenant_id', 'code']);
  });

  it('orders tables so a table is created after whatever it points at', () => {
    defineTable({ name: 'child', module: 'test', tenantScoped: false, columns: { parent_id: col.fk('parent') } });
    defineTable({ name: 'parent', module: 'test', tenantScoped: false, columns: { name: col.text() } });
    const order = tablesInDependencyOrder().map((t) => t.name);
    expect(order.indexOf('parent')).toBeLessThan(order.indexOf('child'));
  });
});

describe('introspection normalising', () => {
  it('lines up Postgres type spellings with the ones used in the model', () => {
    expect(normaliseType('character varying', null, null)).toBe('text');
    expect(normaliseType('timestamp with time zone', null, null)).toBe('timestamptz');
    expect(normaliseType('numeric', 20, 4)).toBe('numeric(20,4)');
  });

  it('strips the casts Postgres attaches to defaults', () => {
    expect(normaliseDefault("'draft'::text")).toBe("'draft'");
    expect(normaliseDefault("'{}'::jsonb")).toBe("'{}'");
    expect(normaliseDefault('now()')).toBe('now()');
    expect(normaliseDefault(null)).toBeNull();
  });
});
