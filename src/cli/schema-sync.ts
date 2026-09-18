/** `npm run db:sync` — applies the plan without starting the HTTP server. */
import '../bootstrap.js';
import { pool, closePool, checkConnection } from '../core/db/pool.js';
import { syncSchema } from '../core/db/schema/sync.js';
import { syncMode } from '../core/config/env.js';

async function main(): Promise<void> {
  await checkConnection();
  const result = await syncSchema(pool, syncMode === 'off' ? 'safe' : syncMode);
  console.log(
    `\n${result.applied.length} applied · ${result.blocked.length} blocked · ${result.skipped.length} failed  (${result.durationMs}ms)\n`,
  );
  if (result.blocked.length > 0 || result.skipped.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
