/**
 * The vocabulary the whole app uses to describe what the database SHOULD look
 * like. Nothing here talks to Postgres — these are plain data structures.
 * `introspect.ts` reads what the DB actually looks like, `diff.ts` compares the
 * two, and `apply.ts` runs the SQL that closes the gap.
 */

export type SqlType =
  | 'uuid'
  | 'text'
  | 'boolean'
  | 'integer'
  | 'bigint'
  | 'date'
  | 'timestamptz'
  | 'jsonb'
  | `numeric(${number},${number})`;

export interface ForeignKeyDef {
  /** Referenced table name (unqualified, same schema). */
  table: string;
  /** Referenced column. Defaults to `id`. */
  column?: string;
  onDelete?: 'cascade' | 'restrict' | 'set null' | 'no action';
  onUpdate?: 'cascade' | 'restrict' | 'no action';
}

export interface ColumnDef {
  type: SqlType;
  notNull?: boolean;
  /** Raw SQL default, e.g. `now()` or `'draft'` (quote string literals yourself). */
  default?: string;
  /** Shorthand for a single-column unique constraint. */
  unique?: boolean;
  references?: ForeignKeyDef;
  /** Raw SQL boolean expression. `{col}` is replaced with the column name. */
  check?: string;
  /** Documentation only — surfaced in the generated data dictionary. */
  comment?: string;
}

export interface IndexDef {
  /** Omit to auto-generate `ix_<table>_<cols>`. */
  name?: string;
  columns: string[];
  unique?: boolean;
  /**
   * Unique indexes only. Postgres treats NULLs as distinct by default, so two
   * rows with a null in the indexed column never collide. Set this when "no
   * value" must still count as a duplicate. Requires Postgres 15 or newer.
   */
  nullsNotDistinct?: boolean;
  /** Raw SQL predicate for a partial index, e.g. `deleted_at is null`. */
  where?: string;
  method?: 'btree' | 'gin' | 'brin';
}

export interface UniqueDef {
  name?: string;
  columns: string[];
  /**
   * Postgres treats NULLs as distinct by default, so (5, null) and (5, null)
   * would both be allowed through a unique constraint. Set this when one of the
   * columns is nullable and "no value" must still count as a duplicate —
   * a branch-level setting with branch_id = null, for instance.
   * Requires Postgres 15 or newer.
   */
  nullsNotDistinct?: boolean;
}

export interface CheckDef {
  name: string;
  expression: string;
}

export interface TableDef {
  name: string;
  /** Which business module owns this table. Used for grouping + docs. */
  module: string;
  /**
   * When true (the default) the table gets a `tenant_id` column, a tenant
   * index, and Row Level Security so one tenant can never read another's rows.
   * Set to false only for platform-level tables (the tenant list itself, etc).
   */
  tenantScoped?: boolean;
  /** Adds created_at / updated_at / created_by / updated_by. Default true. */
  timestamps?: boolean;
  /** Adds a nullable `deleted_at`. Default false. */
  softDelete?: boolean;
  columns: Record<string, ColumnDef>;
  indexes?: IndexDef[];
  uniques?: UniqueDef[];
  checks?: CheckDef[];
  comment?: string;
}

/** A table after defaults + tenant/timestamp columns have been folded in. */
export interface ResolvedTable extends Required<Omit<TableDef, 'comment' | 'checks' | 'uniques' | 'indexes'>> {
  indexes: IndexDef[];
  uniques: UniqueDef[];
  checks: CheckDef[];
  comment?: string;
}

/* ------------------------------------------------------------------ */
/* What the live database currently looks like                         */
/* ------------------------------------------------------------------ */

export interface LiveColumn {
  name: string;
  type: string; // normalised, e.g. "numeric(20,4)"
  notNull: boolean;
  default: string | null;
}

export interface LiveConstraint {
  name: string;
  kind: 'p' | 'f' | 'u' | 'c';
  definition: string;
}

export interface LiveIndex {
  name: string;
  definition: string;
  isConstraintBacked: boolean;
}

export interface LiveTable {
  name: string;
  columns: Map<string, LiveColumn>;
  constraints: Map<string, LiveConstraint>;
  indexes: Map<string, LiveIndex>;
  rlsEnabled: boolean;
  rlsForced: boolean;
  policies: Set<string>;
}

export type LiveSchema = Map<string, LiveTable>;

/* ------------------------------------------------------------------ */
/* The diff                                                            */
/* ------------------------------------------------------------------ */

/**
 * safe        — cannot lose data (create table, add nullable column, add index)
 * warn        — could fail or lock, but does not drop data (set NOT NULL, type widening)
 * destructive — drops or rewrites data (drop column, drop table, narrow a type)
 */
export type ChangeRisk = 'safe' | 'warn' | 'destructive';

export type ChangeKind =
  | 'create_table'
  | 'add_column'
  | 'alter_column_type'
  | 'set_not_null'
  | 'drop_not_null'
  | 'set_default'
  | 'drop_default'
  | 'add_constraint'
  | 'drop_constraint'
  | 'create_index'
  | 'drop_index'
  | 'drop_column'
  | 'drop_table'
  | 'enable_rls'
  | 'create_policy'
  | 'comment';

export interface SchemaChange {
  kind: ChangeKind;
  risk: ChangeRisk;
  table: string;
  object?: string;
  /** Human sentence shown in the boot log / plan output. */
  description: string;
  sql: string[];
  /** Set when the change is blocked and needs a human decision. */
  blockedReason?: string;
}
