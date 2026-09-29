import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../util/logger.js';

const { Pool, types } = pg;

// Postgres `numeric` arrives as a string and stays a string. Letting node-pg
// turn it into a JS float would round money and weights invisibly.
types.setTypeParser(types.builtins.NUMERIC, (value) => value);
// `bigint` likewise — beyond 2^53 a JS number stops being exact.
types.setTypeParser(types.builtins.INT8, (value) => value);
// A `date` is a calendar day, not an instant. Left alone, node-pg turns
// 2026-09-14 into a JS Date at local midnight, which serialises to JSON as
// 2026-09-13T18:30:00Z in India — an invoice dated the day before it was
// raised. Keeping it as the plain string it already is avoids the whole class
// of bug.
types.setTypeParser(types.builtins.DATE, (value) => value);

function sslOption(): pg.ConnectionConfig['ssl'] {
  if (env.DATABASE_SSL === true) return { rejectUnauthorized: true };
  if (env.DATABASE_SSL === 'no-verify') return { rejectUnauthorized: false };
  return undefined;
}

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  ssl: sslOption(),
  application_name: 'karat-setu',
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 30_000,
});

pool.on('error', (error) => {
  logger.error({ err: error }, 'Idle database connection errored');
});

// A connection dropped mid-request (the database restarted, the network blinked)
// fails that request only. Unheard, the error would stop the whole server.
pool.on('connect', (client) => {
  client.on('error', (error) => logger.error({ err: error }, 'Database connection dropped'));
});

export async function checkConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ version: string; db: string; usr: string }>(
      `select version() as version, current_database() as db, current_user as usr`,
    );
    const row = rows[0]!;
    logger.info(
      { database: row.db, user: row.usr, version: row.version.split(',')[0] },
      'Connected to Postgres',
    );
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
