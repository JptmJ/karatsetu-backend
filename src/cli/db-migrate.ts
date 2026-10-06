/**
 * `npm run db:migrate` — makes the database tables match the code.
 *
 * Every table is declared in a `*.schema.ts` file. This command compares those
 * declarations with the real database and lists what is different, then fixes it.
 *
 *   npm run db:migrate                 -- show the changes, then apply the safe ones
 *   npm run db:migrate -- --dry-run    -- only show the changes, touch nothing
 *   npm run db:migrate -- --force      -- also apply BLOCKED changes (they delete data)
 *
 * Each change is labelled:
 *
 *   SAFE     adds something new (a table, a column, an index). Always applied.
 *   CAREFUL  adds a rule existing rows must follow (a foreign key, a unique
 *            constraint). Applied, but can fail if old rows break the rule —
 *            the error says which change, so fix the data and run again.
 *   BLOCKED  would delete or rewrite data (dropping a column, changing a type).
 *            Never applied unless you pass --force. Read the reason first.
 *
 * The server also runs the SAFE part on every start (SCHEMA_SYNC_MODE=safe), so
 * day to day you rarely need this. Use it to check before a deploy, and in
 * production, where the server is not allowed to change tables by itself.
 */
import '../bootstrap.js';
import { pool, closePool, checkConnection } from '../core/db/pool.js';
import { planSchema, syncSchema } from '../core/db/schema/sync.js';
import { buildStamp } from '../core/util/version.js';

const has = (flag: string): boolean => process.argv.includes(`--${flag}`);
const LABEL = { safe: 'SAFE   ', warn: 'CAREFUL', destructive: 'BLOCKED' } as const;

async function main(): Promise<void> {
  const dryRun = has('dry-run');
  const force = has('force');

  await checkConnection();

  // 1. What is different?
  const changes = await planSchema(pool);
  if (changes.length === 0) {
    console.log('\n✔ The database already matches the code. Nothing to do.\n');
    return;
  }

  console.log(`\n${changes.length} difference(s) between the code and the database:\n`);
  for (const change of changes) {
    console.log(`  ${LABEL[change.risk]}  ${change.description}`);
    if (change.blockedReason) console.log(`           ↳ ${change.blockedReason}`);
  }
  if (process.env.SHOW_SQL === 'true') {
    console.log('\n--- SQL ---\n');
    for (const change of changes) for (const statement of change.sql) console.log(`${statement};`);
  }

  if (dryRun) {
    console.log('\nDry run — nothing was changed. Run without --dry-run to apply.\n');
    return;
  }

  // 2. Apply them.
  console.log(force ? '\nApplying ALL changes, including blocked ones (--force)…\n' : '\nApplying…\n');
  const result = await syncSchema(pool, force ? 'force' : 'safe', buildStamp());

  // 3. Say what happened.
  console.log(`\n  ${result.applied.length} applied · ${result.blocked.length} blocked · ${result.skipped.length} failed  (${result.durationMs}ms)\n`);
  if (result.skipped.length > 0) {
    console.log('Some changes failed — the log above says why. Fix the data and run again.\n');
    process.exitCode = 1;
  }
  if (result.blocked.length > 0) {
    console.log('Blocked changes were left alone. Either change the schema file, or, once you are sure');
    console.log('the data can go, run: npm run db:migrate -- --force\n');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
