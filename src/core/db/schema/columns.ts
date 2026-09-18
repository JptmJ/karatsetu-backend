/**
 * Small helpers so table definitions read like a sentence instead of a wall of
 * config objects. Every helper just returns a ColumnDef.
 *
 * Money and weight deliberately use `numeric` (never float) — in a jewellery
 * business a rounding error is a real rupee that someone has to explain.
 */
import type { ColumnDef, ForeignKeyDef, SqlType } from './types.js';

/** Rupees. 20 digits total, 4 after the decimal point. */
export const MONEY: SqlType = 'numeric(20,4)';
/** Grams. 6 decimals = microgram precision, far beyond any scale in a shop. */
export const WEIGHT: SqlType = 'numeric(16,6)';
/** Percent / fineness, e.g. 91.600 for 22K. */
export const PURITY: SqlType = 'numeric(7,3)';
/** Generic rate or ratio, e.g. making charge %, wastage %. */
export const RATE: SqlType = 'numeric(14,6)';

type Opts = Omit<ColumnDef, 'type'>;

const make = (type: SqlType) => (opts: Opts = {}): ColumnDef => ({ type, ...opts });

export const col = {
  /** Primary key. Generated in the app (uuid v7-ish) so inserts stay batchable. */
  uuidPk: (): ColumnDef => ({ type: 'uuid', notNull: true }),
  uuid: make('uuid'),
  text: make('text'),
  bool: make('boolean'),
  int: make('integer'),
  bigint: make('bigint'),
  date: make('date'),
  timestamptz: make('timestamptz'),
  jsonb: make('jsonb'),
  money: make(MONEY),
  weight: make(WEIGHT),
  purity: make(PURITY),
  rate: make(RATE),
  numeric: (precision: number, scale: number, opts: Opts = {}): ColumnDef => ({
    type: `numeric(${precision},${scale})` as SqlType,
    ...opts,
  }),

  /**
   * A foreign key to another table's `id`. Defaults to `restrict` on delete —
   * business records should never silently vanish because a master was removed.
   */
  fk: (table: string, opts: Opts & { onDelete?: ForeignKeyDef['onDelete'] } = {}): ColumnDef => {
    const { onDelete = 'restrict', ...rest } = opts;
    return { type: 'uuid', references: { table, column: 'id', onDelete }, ...rest };
  },

  /**
   * A short closed set of values, stored as text with a CHECK constraint.
   * Text + CHECK rather than a Postgres enum: adding a value later is a plain
   * constraint swap instead of a migration that locks the type.
   */
  enum: (values: readonly string[], opts: Opts = {}): ColumnDef => ({
    type: 'text',
    check: `{col} in (${values.map((v) => `'${v}'`).join(', ')})`,
    ...opts,
  }),
} as const;
