import fs from 'node:fs';
import dotenv from 'dotenv';
import '../src/bootstrap.js';
import { env } from '../src/core/config/env.js';

// Safety check: Refuse to run if test database/schema is identical to development
let devUrl = '';
let devSchema = 'public';

if (fs.existsSync('.env')) {
  const devEnv = dotenv.parse(fs.readFileSync('.env', 'utf8'));
  devUrl = devEnv.DATABASE_URL || '';
  devSchema = devEnv.DATABASE_SCHEMA || 'public';
}

const testUrl = env.DATABASE_URL;
const testSchema = env.DATABASE_SCHEMA;

if (testUrl && testUrl === devUrl && testSchema === devSchema) {
  const errorMsg =
    `\n================================================================================\n` +
    `CRITICAL TEST ERROR: REFUSING TO RUN AGAINST DEVELOPMENT DATABASE\n` +
    `--------------------------------------------------------------------------------\n` +
    `The test runner is configured with:\n` +
    `  DATABASE_URL:    ${testUrl}\n` +
    `  DATABASE_SCHEMA: ${testSchema}\n\n` +
    `This exactly matches the development database in .env!\n` +
    `Integration tests insert, alter, and delete real data (such as 120 parties).\n` +
    `Tests must never share a database or schema with development.\n\n` +
    `To fix this:\n` +
    `  Set a separate DATABASE_SCHEMA (e.g. DATABASE_SCHEMA=app_test) or a separate\n` +
    `  DATABASE_URL in .env.test.\n` +
    `================================================================================\n`;
  console.error(errorMsg);
  throw new Error(errorMsg);
}
