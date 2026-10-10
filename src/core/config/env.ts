import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import dotenv from 'dotenv';
import { z } from 'zod';
import type { SyncMode } from '../db/schema/sync.js';

// Load default .env first
dotenv.config();

// When running tests, override with .env.test if present
if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
  dotenv.config({ path: '.env.test', override: true });
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  /** Paste the Postgres connection string here. Everything else has a default. */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required — put it in .env'),
  DATABASE_SSL: z
    .enum(['true', 'false', 'no-verify'])
    .default('false')
    .transform((v) => (v === 'true' ? true : v === 'no-verify' ? ('no-verify' as const) : false)),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  /** Seconds between checks for report alerts and schedules that are due. 0 turns the timer off. */
  REPORTS_TICK_SECONDS: z.coerce.number().int().min(0).default(300),
  DATABASE_SCHEMA: z.string().default('public'),
  /** Seconds between database health checks in the log. 0 turns them off. */
  DB_HEARTBEAT_SECONDS: z.coerce.number().int().min(0).default(60),

  SCHEMA_SYNC_MODE: z.enum(['off', 'verify', 'safe', 'force']).default('verify'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),

  /**
   * Web apps on OTHER origins allowed to call this API with cookies, comma
   * separated, e.g. "https://erp.swarnay.com,http://localhost:5173". Not needed
   * when the app reaches the API through its own origin (Vite proxy / rewrite).
   */
  CORS_ORIGINS: z.string().default('')
    .transform((v) => v.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean)),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Configuration problem — the server cannot start:\n${issues}\n`);
  process.exit(1);
}

// In production, server must never apply schema changes on boot.
const isDbSyncCli = process.argv.some((arg) => arg.includes('db-migrate'));
if (
  !isDbSyncCli &&
  parsed.data.NODE_ENV === 'production' &&
  (parsed.data.SCHEMA_SYNC_MODE === 'safe' || parsed.data.SCHEMA_SYNC_MODE === 'force')
) {
  console.error('Schema changes in production run only through npm run db:migrate as a deploy step.');
  process.exit(1);
}

export const env = parsed.data;
export const syncMode: SyncMode = env.SCHEMA_SYNC_MODE;
export const isProduction = env.NODE_ENV === 'production';
