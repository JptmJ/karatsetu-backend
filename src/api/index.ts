/**
 * Importing this file registers every endpoint.
 *
 * Order matters only for readability — the registry sorts by module for the
 * docs and Express matches on the declared path.
 */
import './routes.core.js';
import './routes.master.js';
import './routes.orders.js';
import './routes.operations.js';
import './routes.commercial.js';
import './routes.users.js';

/* Platform (super admin) routes — mounted on a separate router in app.ts. */
import './routes.platform.js';

export { buildRouter, allRoutes, changeFeed } from '../core/http/route-registry.js';
