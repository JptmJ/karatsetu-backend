/**
 * Every permission a role may be given. Built from the routes (each declares
 * its permission) plus the role templates, so it can never drift from the API.
 */
import { allRoutes } from '../../core/http/route-registry.js';
import { ValidationError } from '../../core/errors/app-error.js';
import { TENANT_ROLES } from '../platform/roles.js';

export interface PermissionEntry { module: string; code: string; description: string }

/** Permissions that gate UI or fields rather than a route (e.g. "stock.field.cost_value.view"). */
const EXTRA: PermissionEntry[] = [];

export function permissionCatalog(): PermissionEntry[] {
  const byCode = new Map<string, PermissionEntry>();
  const add = (code: string, description: string) => {
    if (code === '*' || code.endsWith('.*') || byCode.has(code)) return;
    byCode.set(code, { module: code.split('.')[0]!, code, description });
  };
  for (const route of allRoutes()) if (route.permission) add(route.permission, route.summary);
  for (const role of TENANT_ROLES) for (const p of role.permissions) add(p, p);
  for (const e of EXTRA) byCode.set(e.code, e);
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function assertKnownPermissions(permissions: string[]): void {
  const catalog = permissionCatalog();
  const codes = new Set(catalog.map((c) => c.code));
  const modules = new Set(catalog.map((c) => c.module));
  const unknown = permissions.filter(
    (p) => !(p === '*' || codes.has(p) || (p.endsWith('.*') && modules.has(p.slice(0, -2)))),
  );
  if (unknown.length) throw new ValidationError(`Unknown permission(s): ${unknown.join(', ')}`);
}
