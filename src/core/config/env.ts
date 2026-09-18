import 'dotenv/config';
import { z } from 'zod';
import type { SyncMode } from '../db/schema/sync.js';

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
  DATABASE_SCHEMA: z.string().default('public'),

  SCHEMA_SYNC_MODE: z.enum(['off', 'verify', 'safe', 'force']).default('safe'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),

  /** Comma-separated origins allowed to call the API from a browser. */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Configuration problem — the server cannot start:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;
export const syncMode: SyncMode = env.SCHEMA_SYNC_MODE;
export const isProduction = env.NODE_ENV === 'production';
