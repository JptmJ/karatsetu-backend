/**
 * `npm run db:plan` — shows what the next boot would change, without touching
 * anything. This is what you run before deploying to production.
 */
import '../bootstrap.js';
import { pool, closePool, checkConnection } from '../core/db/pool.js';
import { planSchema } from '../core/db/schema/sync.js';
import { allTables } from '../core/db/schema/registry.js';

const RISK_LABEL = { safe: 'SAFE ', warn: 'WARN ', destructive: 'STOP ' } as const;

async function main(): Promise<void> {
  await checkConnection();
  const changes = await planSchema(pool);

  console.log(`\nModel declares ${allTables().length} tables.\n`);

  if (changes.length === 0) {
    console.log('The database already matches. Nothing to do.\n');
    return;
  }

  const byRisk = { safe: 0, warn: 0, destructive: 0 };
  for (const change of changes) byRisk[change.risk]++;

  console.log(`${changes.length} change(s) pending:\n`);
  for (const change of changes) {
    console.log(`  ${RISK_LABEL[change.risk]} ${change.description}`);
    if (change.blockedReason) console.log(`        ↳ blocked: ${change.blockedReason}`);
  }

  console.log(
    `\n  ${byRisk.safe} safe · ${byRisk.warn} needs care · ${byRisk.destructive} blocked\n`,
  );

  if (byRisk.destructive > 0) {
    console.log('Blocked changes are never applied automatically.');
    console.log('Review them, then either fix the model or run with SCHEMA_SYNC_MODE=force.\n');
  }

  if (process.env.SHOW_SQL === 'true') {
    console.log('--- SQL ---\n');
    for (const change of changes) for (const statement of change.sql) console.log(`${statement};\n`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
