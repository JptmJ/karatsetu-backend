import './bootstrap.js';
import { createApp } from './app.js';
import { env, syncMode } from './core/config/env.js';
import { checkConnection, closePool, pool } from './core/db/pool.js';
import { syncSchema } from './core/db/schema/sync.js';
import { allTables } from './core/db/schema/registry.js';
import { logger } from './core/util/logger.js';

/**
 * Boot order matters:
 *   1. can we reach the database at all?
 *   2. bring its shape in line with the code
 *   3. only then start accepting requests
 *
 * Nothing serves traffic against a schema it does not understand.
 */
async function main(): Promise<void> {
  logger.info(
    { env: env.NODE_ENV, tables: allTables().length, schemaSync: syncMode },
    'Starting KaratSetu backend',
  );

  await checkConnection();
  await syncSchema(pool, syncMode);

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`Listening on http://localhost:${env.PORT}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    // Do not let a hung connection keep the process alive forever.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Could not start');
  process.exit(1);
});
