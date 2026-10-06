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

  it('drops a unique rule the model no longer has, and keeps the ones it does', () => {
    defineTable({ name: 'widget', module: 'test', tenantScoped: false, timestamps: false, columns: { code: col.text() }, uniques: [{ columns: ['code'] }] });
    const table = liveTable('widget', { id: { type: 'uuid', notNull: true }, code: { type: 'text' } });
    for (const name of ['uq_widget_code', 'uq_widget_old']) table.constraints.set(name, { name, kind: 'u', definition: '' });
    const drops = diffSchema(new Map([['widget', table]])).filter((c) => c.kind === 'drop_constraint');
    expect(drops.map((c) => [c.object, c.risk])).toEqual([['uq_widget_old', 'safe']]);
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

  it('repoints a foreign key that now references a different table', () => {
    /*
     * The case this guards: support_session.operator_user_id was moved from
     * app_user to platform_user. The constraint name does not change, so
     * matching on name alone reported the database as matching for ever while
     * every insert failed against the old parent table.
     */
    defineTable({ name: 'operator', module: 'test', tenantScoped: false, columns: { name: col.text() } });
    defineTable({
      name: 'ticket',
      module: 'test',
      tenantScoped: false,
      columns: { operator_id: col.fk('operator', { notNull: true }) },
    });

    const live = new Map([
      ['operator', liveTable('operator', { id: { type: 'uuid' }, name: { type: 'text' } })],
      ['ticket', liveTable('ticket', { id: { type: 'uuid' }, operator_id: { type: 'uuid', notNull: true } })],
    ]) as LiveSchema;

    live.get('ticket')!.constraints.set('fk_ticket_operator_id', {
      name: 'fk_ticket_operator_id',
      kind: 'f',
      definition: 'FOREIGN KEY (operator_id) REFERENCES staff(id) ON DELETE RESTRICT',
    });

    const change = diffSchema(live).find((c) => c.object === 'fk_ticket_operator_id');
    expect(change).toBeDefined();
    expect(change!.description).toContain('repoint');
    // Dropped first, then recreated against the right parent.
    expect(change!.sql[0]).toContain('drop constraint "fk_ticket_operator_id"');
    expect(change!.sql[1]).toContain('references "operator"');
  });

  it('leaves a foreign key alone when it already points at the right table', () => {
    defineTable({ name: 'operator', module: 'test', tenantScoped: false, columns: { name: col.text() } });
    defineTable({
      name: 'ticket',
      module: 'test',
      tenantScoped: false,
      columns: { operator_id: col.fk('operator', { notNull: true }) },
    });

    const live = new Map([
      ['operator', liveTable('operator', { id: { type: 'uuid' }, name: { type: 'text' } })],
      ['ticket', liveTable('ticket', { id: { type: 'uuid' }, operator_id: { type: 'uuid', notNull: true } })],
    ]) as LiveSchema;

    live.get('ticket')!.constraints.set('fk_ticket_operator_id', {
      name: 'fk_ticket_operator_id',
      kind: 'f',
      // Postgres prints its own wording for the delete rule; that must not
      // count as a difference or every sync would rebuild the same key.
      definition: 'FOREIGN KEY (operator_id) REFERENCES operator(id) ON DELETE RESTRICT',
    });

    expect(diffSchema(live).find((c) => c.object === 'fk_ticket_operator_id')).toBeUndefined();
  });

  it('drops a value check the model no longer declares', () => {
    /*
     * The case this guards: app_user.role_code listed six allowed roles, four
     * were retired, and the column became free text. Every sync then tried to
     * narrow a list that was no longer in the model and failed, while the
     * database went on refusing the values the model now allowed.
     */
    defineTable({ name: 'widget', module: 'test', columns: { label: col.text() } });

    const live = new Map([
      ['widget', liveTable('widget', { id: { type: 'uuid' }, label: { type: 'text' } })],
    ]) as LiveSchema;

    live.get('widget')!.constraints.set('ck_widget_label', {
      name: 'ck_widget_label',
      kind: 'c',
      definition: "CHECK ((label = ANY (ARRAY['a'::text, 'b'::text])))",
    });

    const change = diffSchema(live).find((c) => c.object === 'ck_widget_label');
    expect(change?.kind).toBe('drop_constraint');
    expect(change?.risk).toBe('safe');
    expect(change?.sql[0]).toContain('drop constraint "ck_widget_label"');
  });

  it('leaves a check somebody added by hand alone', () => {
    // Only our own ck_ names are ours to remove.
    defineTable({ name: 'widget', module: 'test', columns: { label: col.text() } });

    const live = new Map([
      ['widget', liveTable('widget', { id: { type: 'uuid' }, label: { type: 'text' } })],
    ]) as LiveSchema;

    live.get('widget')!.constraints.set('widget_label_not_blank', {
      name: 'widget_label_not_blank',
      kind: 'c',
      definition: "CHECK ((label <> ''::text))",
    });

    expect(diffSchema(live).find((c) => c.object === 'widget_label_not_blank')).toBeUndefined();
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
