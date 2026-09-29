/** `npm run db:sync` — applies the plan without starting the HTTP server. */
import '../bootstrap.js';
import { pool, closePool, checkConnection } from '../core/db/pool.js';
import { syncSchema } from '../core/db/schema/sync.js';
import { syncMode } from '../core/config/env.js';
import { buildStamp } from '../core/util/version.js';

async function main(): Promise<void> {
  await checkConnection();
  const mode = syncMode === 'force' || process.env.SCHEMA_SYNC_MODE === 'force' ? 'force' : 'safe';
  const result = await syncSchema(pool, mode, buildStamp());
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
