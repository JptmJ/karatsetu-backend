import express from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from './core/util/logger.js';
import { authenticate, authenticatePlatform, cors, errorHandler, requestId } from './core/http/middleware.js';
import { pool } from './core/db/pool.js';
import { isProduction } from './core/config/env.js';
import { buildRouter } from './api/index.js';
import { routeScope } from './core/http/route-registry.js';
import { renderDevDocs } from './core/docs/dev-docs.js';
import { allRoutes } from './core/http/route-registry.js';

const VERSION = '0.2.0';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Behind a proxy (nginx, a rewrite) the client IP arrives in X-Forwarded-For.
  app.set('trust proxy', isProduction);
  // Only for apps on another origin (see CORS_ORIGINS); same-origin calls skip it.
  app.use(cors);
  app.use(express.json({ limit: '4mb' }));
  app.use(requestId);

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req: { url?: string }) => req.url === '/health' || req.url?.startsWith('/dev-docs') === true },
      customLogLevel: (_req: unknown, res: { statusCode: number }, err?: unknown) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }),
  );

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('select 1');
      res.json({ status: 'ok', database: 'up', version: VERSION, endpoints: allRoutes().length, at: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'down' });
    }
  });

  /**
   * Live API documentation. Rendered from the route registry on every request,
   * so it is always exactly what this server is running.
   */
  app.get('/dev-docs', (req, res) => {
    const proto = (req.headers['x-forwarded-proto'] as string) ?? req.protocol;
    res.type('html').send(renderDevDocs({ version: VERSION, baseUrl: `${proto}://${req.get('host')}` }));
  });

  /** The same content as JSON, for tooling and the client generator. */
  app.get('/dev-docs.json', (_req, res) => {
    res.json({
      version: VERSION,
      generatedAt: new Date().toISOString(),
      endpoints: allRoutes().map((r) => ({
        method: r.method, path: r.path, module: r.module, summary: r.summary,
        description: r.description, permission: r.permission, auth: r.auth !== false,
        responses: r.responses.map((x) => ({ status: x.status, description: x.description })),
        changelog: r.changelog ?? [],
      })),
    });
  });

  app.use('/api/platform', (req, res, next) => {
    if (req.path.startsWith('/auth/')) return next();
    return authenticatePlatform(req, res, next);
  });
  app.use(buildRouter((r) => routeScope(r) === 'platform'));

  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth/') || req.path.startsWith('/platform/')) return next();
    return authenticate(req, res, next);
  });
  app.use(buildRouter((r) => routeScope(r) === 'tenant'));

  app.use((req, res) => {
    res.status(404).json({
      error: { code: 'not_found', message: `No route for ${req.method} ${req.path}`, hint: 'See /dev-docs' },
    });
  });

  app.use(errorHandler);
  return app;
}
