/**
 * The thing that runs on every boot:
 *
 *   1. take a lock so two app instances never migrate at the same time
 *   2. read the live database
 *   3. compare it against what the modules declared
 *   4. apply what is safe, refuse what is not, write down what happened
 *
 * Modes (SCHEMA_SYNC_MODE):
 *   off    — do nothing
 *   verify — report drift and refuse to boot if there is any (use in production)
 *   safe   — apply additive changes automatically, block destructive ones (default for dev)
 *   force  — apply everything, including drops (never point this at production)
 */
import type { Pool, PoolClient } from 'pg';
import type { SchemaChange } from './types.js';
import { diffSchema } from './diff.js';
import { introspect } from './introspect.js';
import { allTables } from './registry.js';
import { logger } from '../../util/logger.js';
import { env } from '../../config/env.js';

export type SyncMode = 'off' | 'verify' | 'safe' | 'force';

/** Any number works; it just has to be the same in every instance of the app. */
const ADVISORY_LOCK_KEY = 8_524_113_907_001n;

export interface SyncResult {
  mode: SyncMode;
  applied: SchemaChange[];
  blocked: SchemaChange[];
  skipped: SchemaChange[];
  durationMs: number;
}

const CHANGE_LOG_DDL = `
create table if not exists _schema_change_log (
  id            bigserial primary key,
  applied_at    timestamptz not null default now(),
  kind          text        not null,
  risk          text        not null,
  table_name    text        not null,
  object_name   text,
  description   text        not null,
  statements    text[]      not null,
  app_version   text,
  duration_ms   integer
)`;

function isAllowed(change: SchemaChange, mode: SyncMode): boolean {
  if (mode === 'force') return true;
  if (change.blockedReason) return false;
  if (change.risk === 'safe') return true;
  // `warn` changes add structure without deleting data (foreign keys, unique
  // constraints, indexes). They can fail on dirty data, but they cannot destroy
  // anything, so `safe` mode attempts them and reports failures clearly.
  return change.risk === 'warn' && mode === 'safe';
}

export async function syncSchema(pool: Pool, mode: SyncMode, appVersion = '0.1.0'): Promise<SyncResult> {
  const startedAt = Date.now();

  if (mode === 'off') {
    logger.warn('Schema sync is off — assuming the database already matches the code.');
    return { mode, applied: [], blocked: [], skipped: [], durationMs: 0 };
  }

  const client = await pool.connect();
  try {
    // Platform code touches every tenant's tables, so step outside RLS.
    await client.query(`set local app.bypass_rls = 'on'`);
    await client.query('select pg_advisory_lock($1)', [ADVISORY_LOCK_KEY.toString()]);

    try {
      await client.query(CHANGE_LOG_DDL);

      const live = await introspect(client, env.DATABASE_SCHEMA);
      const changes = diffSchema(live);

      if (changes.length === 0) {
        logger.info(
          { tables: allTables().length },
          'Database matches the application model. Nothing to change.',
        );
        return { mode, applied: [], blocked: [], skipped: [], durationMs: Date.now() - startedAt };
      }

      if (mode === 'verify') {
        logger.error({ count: changes.length }, 'Database does not match the application model.');
        for (const c of changes) logger.error(`  [${c.risk}] ${c.description}`);
        throw new Error(
          `Schema drift detected: ${changes.length} change(s) needed. Running in "verify" mode, so nothing was applied.`,
        );
      }

      const applied: SchemaChange[] = [];
      const blocked: SchemaChange[] = [];
      const skipped: SchemaChange[] = [];

      const allowed: SchemaChange[] = [];
      for (const change of changes) {
        if (isAllowed(change, mode)) allowed.push(change);
        else blocked.push(change);
      }

      // Changes are applied in batches inside one transaction. Against a remote
      // database the round trip dominates everything else — a first-run sync of
      // ~600 changes takes a quarter of an hour one-at-a-time and under a minute
      // batched. When a batch fails it is retried one change at a time, so a
      // single bad statement still gets isolated and reported precisely.
      for (let i = 0; i < allowed.length; i += BATCH_SIZE) {
        const batch = allowed.slice(i, i + BATCH_SIZE);
        if (await applyBatch(client, batch, appVersion)) {
          applied.push(...batch);
          continue;
        }
        for (const change of batch) {
          const ok = await applyChange(client, change, appVersion);
          (ok ? applied : skipped).push(change);
        }
      }

      for (const c of applied) logger.info(`  applied  ${c.description}`);
      for (const c of skipped) logger.warn(`  failed   ${c.description}`);
      for (const c of blocked) {
        logger.warn(`  blocked  [${c.risk}] ${c.description}`);
        if (c.blockedReason) logger.warn(`           reason: ${c.blockedReason}`);
      }

      logger.info(
        { applied: applied.length, blocked: blocked.length, failed: skipped.length },
        'Schema sync finished.',
      );

      return { mode, applied, blocked, skipped, durationMs: Date.now() - startedAt };
    } finally {
      await client.query('select pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY.toString()]);
    }
  } finally {
    client.release();
  }
}

/** How many changes share one transaction on the fast path. */
const BATCH_SIZE = 25;

/**
 * Applies a whole batch in one transaction. Returns false if anything in it
 * failed, in which case the caller falls back to applying them individually.
 * Nothing is logged here — a batch failure is expected and recoverable.
 */
async function applyBatch(client: PoolClient, batch: SchemaChange[], appVersion: string): Promise<boolean> {
  if (batch.length === 0) return true;
  const startedAt = Date.now();
  try {
    await client.query('begin');
    for (const change of batch) {
      for (const statement of change.sql) await client.query(statement);
    }
    // One insert for the whole batch rather than one per change.
    const values: unknown[] = [];
    const tuples = batch.map((change) => {
      const base = values.length;
      values.push(
        change.kind, change.risk, change.table, change.object ?? null,
        change.description, change.sql, appVersion,
        Math.round((Date.now() - startedAt) / batch.length),
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
    });
    await client.query(
      `insert into _schema_change_log (kind, risk, table_name, object_name, description, statements, app_version, duration_ms)
       values ${tuples.join(', ')}`,
      values,
    );
    await client.query('commit');
    return true;
  } catch {
    await client.query('rollback').catch(() => undefined);
    return false;
  }
}

/**
 * The slow, precise path: one change, one transaction, and a clear log line if
 * it fails. Used to isolate whichever statement broke a batch.
 */
async function applyChange(client: PoolClient, change: SchemaChange, appVersion: string): Promise<boolean> {
  const startedAt = Date.now();
  try {
    await client.query('begin');
    for (const statement of change.sql) await client.query(statement);
    await client.query(
      `insert into _schema_change_log (kind, risk, table_name, object_name, description, statements, app_version, duration_ms)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        change.kind,
        change.risk,
        change.table,
        change.object ?? null,
        change.description,
        change.sql,
        appVersion,
        Date.now() - startedAt,
      ],
    );
    await client.query('commit');
    return true;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    logger.error(
      { err: error, table: change.table, sql: change.sql },
      `Could not apply: ${change.description}`,
    );
    return false;
  }
}

/** Read-only: what WOULD change. Used by `npm run db:plan`. */
export async function planSchema(pool: Pool): Promise<SchemaChange[]> {
  const client = await pool.connect();
  try {
    await client.query(`set local app.bypass_rls = 'on'`);
    return diffSchema(await introspect(client, env.DATABASE_SCHEMA));
  } finally {
    client.release();
  }
}
