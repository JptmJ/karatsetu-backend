/**
 * Who is making the current request.
 *
 * Carried in AsyncLocalStorage rather than passed down as an argument, so that
 * a service five calls deep physically cannot run a query without a tenant —
 * `db.query` reads the tenant from here, and throws if it is missing.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  tenantId: string;
  userId: string | null;
  branchId: string | null;
  roles: string[];
  permissions: Set<string>;
  /** Platform-level work (schema sync, tenant provisioning) that spans tenants. */
  bypassRls?: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(context: RequestContext, fn: () => T): T =>
  storage.run(context, fn);

export const getContext = (): RequestContext | undefined => storage.getStore();

export function requireContext(): RequestContext {
  const context = storage.getStore();
  if (!context) {
    throw new Error(
      'No request context. A tenant-scoped query was attempted outside a request — wrap it in runWithContext() or use db.asPlatform().',
    );
  }
  return context;
}

/** For schema sync, tenant provisioning and cron jobs that legitimately cross tenants. */
export const platformContext = (requestId = 'platform'): RequestContext => ({
  requestId,
  tenantId: '00000000-0000-0000-0000-000000000000',
  userId: null,
  branchId: null,
  roles: ['platform'],
  permissions: new Set(['*']),
  bypassRls: true,
});
