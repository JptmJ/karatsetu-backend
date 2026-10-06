/**
 * Who may do what, where. Resolved per request (cached 60s per token version),
 * so a role change or a suspended shop applies without waiting for the access
 * token to expire.
 */
import type { Tx } from '../../core/db/client.js';
import { asTenant } from '../../core/db/client.js';
import { ForbiddenError, UnauthorizedError } from '../../core/errors/app-error.js';
import { catalogFor, type TenantKind, type TenantModuleState } from '../tenancy/module-catalog.js';

export interface BranchRef { id: string; code: string; name: string }

export interface UserAccess {
  userId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  tokenVersion: number;
  mustChangePassword: boolean;
  tenantActive: boolean;
  defaultBranchId: string | null;
  branches: BranchRef[];
  grants: { roleCode: string; branchId: string | null; permissions: string[] }[];
}

export const TENANT_INACTIVE_MESSAGE = 'This shop’s account is not active. Please contact support.';

export async function loadUserAccess(tx: Tx, userId: string): Promise<UserAccess | null> {
  const user = await tx.maybeOne<{
    full_name: string; email: string | null; phone: string | null; token_version: number;
    default_branch_id: string | null; must_change_password: boolean; tenant_active: boolean;
  }>(
    `select u.full_name, u.email, u.phone, u.token_version, u.default_branch_id, u.must_change_password,
            t.status not in ('suspended', 'closed') and t.deleted_at is null as tenant_active
       from app_user u join tenant t on t.id = u.tenant_id
      where u.id = $1 and u.is_active and u.deleted_at is null`,
    [userId],
  );
  if (!user) return null;

  const grants = await tx.query<{ role_code: string; branch_id: string | null; permissions: string[] }>(
    `select r.code as role_code, ur.branch_id,
            coalesce(array_agg(rp.permission) filter (where rp.permission is not null), '{}') as permissions
       from user_role ur
       join role r on r.id = ur.role_id and r.is_active and r.deleted_at is null
       left join role_permission rp on rp.role_id = r.id
      where ur.user_id = $1
      group by r.code, ur.branch_id`,
    [userId],
  );

  const everyBranch = grants.some((g) => g.branch_id === null);
  const branchIds = grants.map((g) => g.branch_id).filter((b): b is string => b !== null);
  const branches = await tx.query<BranchRef>(
    `select id, code, name from branch
      where is_active and deleted_at is null and ($2::boolean or id = any($1::uuid[]))
      order by name`,
    [branchIds, everyBranch],
  );

  return {
    userId,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone,
    tokenVersion: user.token_version,
    mustChangePassword: user.must_change_password,
    tenantActive: user.tenant_active,
    defaultBranchId: user.default_branch_id,
    branches,
    grants: grants.map((g) => ({ roleCode: g.role_code, branchId: g.branch_id, permissions: g.permissions })),
  };
}

/** The branch this request runs in. A requested branch must be one the user holds a role at. */
export function resolveBranch(access: UserAccess, requested: string | undefined): string | null {
  if (requested) {
    if (!access.branches.some((b) => b.id === requested)) {
      throw new ForbiddenError('You do not have access to this branch.', 'branch_forbidden');
    }
    return requested;
  }
  if (access.defaultBranchId && access.branches.some((b) => b.id === access.defaultBranchId)) {
    return access.defaultBranchId;
  }
  return access.branches[0]?.id ?? null;
}

/** Roles and permissions that apply at one branch: branch-specific grants plus every-branch grants. */
export function effectiveGrants(access: UserAccess, branchId: string | null): { roles: string[]; permissions: string[] } {
  const applicable = access.grants.filter((g) => g.branchId === null || g.branchId === branchId);
  return {
    roles: [...new Set(applicable.map((g) => g.roleCode))],
    permissions: [...new Set(applicable.flatMap((g) => g.permissions))],
  };
}

/**
 * Everything the app needs to render after sign-in, in one query: the shop, its
 * modules with licence state, and the theme (branch override first).
 */
export async function describeSession(tx: Tx, access: UserAccess, branchId: string | null) {
  const shop = await tx.one<{
    id: string; code: string; name: string; kind: TenantKind; status: string;
    modules: { module_key: string; enabled: boolean; licence: TenantModuleState['licence'];
      trial_ends_at: string | null; expires_at: string | null; disabled_submodules: string[] | null }[];
    theme: { preset_key: string; css_variables: Record<string, string>; logo_url: string | null } | null;
  }>(
    `select t.id, t.code, t.display_name as name, t.kind, t.status,
            (select coalesce(json_agg(m), '[]') from (
               select module_key, enabled, licence, trial_ends_at, expires_at, disabled_submodules from tenant_module) m) as modules,
            (select row_to_json(th) from (
               select preset_key, css_variables, logo_url from tenant_theme
                where is_active and (branch_id = $2 or branch_id is null)
                order by branch_id nulls last limit 1) th) as theme
       from tenant t where t.id = $1`,
    [tx.context.tenantId, branchId],
  );

  const states = new Map<string, TenantModuleState>(shop.modules.map((m) => [m.module_key, {
    enabled: m.enabled, licence: m.licence, trialEndsAt: m.trial_ends_at,
    expiresAt: m.expires_at, disabled: m.disabled_submodules ?? [],
  }]));

  return {
    user: {
      id: access.userId, fullName: access.fullName, email: access.email, phone: access.phone,
      mustChangePassword: access.mustChangePassword,
    },
    tenant: { id: shop.id, code: shop.code, name: shop.name, kind: shop.kind, status: shop.status },
    branchId,
    branches: access.branches,
    ...effectiveGrants(access, branchId),
    modules: catalogFor(shop.kind, states),
    theme: shop.theme ?? { preset_key: 'deep-forest', css_variables: {}, logo_url: null },
    /*
     * Present only when a platform operator is inside this business. The app
     * uses it to show its support banner, so a shopkeeper can always tell an
     * ordinary sign-in from someone from Swarnay looking at their data.
     */
    support: tx.context.support
      ? {
          sessionId: tx.context.support.sessionId,
          canWrite: tx.context.support.canWrite,
          endsAt: tx.context.support.endsAt,
        }
      : null,
  };
}

export type Session = Awaited<ReturnType<typeof describeSession>>;

const TTL_MS = 60_000;
const MAX_ENTRIES = 5_000;
const cache = new Map<string, { at: number; access: UserAccess }>();
const keyOf = (tenantId: string, userId: string, tokenVersion: number) => `${tenantId}:${userId}:${tokenVersion}`;

export async function getUserAccess(tenantId: string, userId: string, tokenVersion: number): Promise<UserAccess> {
  const key = keyOf(tenantId, userId, tokenVersion);
  const hit = cache.get(key);
  const access = hit && Date.now() - hit.at < TTL_MS
    ? hit.access
    : await asTenant(tenantId, (tx) => loadUserAccess(tx, userId), userId);

  if (!access || access.tokenVersion !== tokenVersion) {
    throw new UnauthorizedError('Your session has expired. Please sign in again.', 'session_expired');
  }
  if (!access.tenantActive) throw new UnauthorizedError(TENANT_INACTIVE_MESSAGE, 'tenant_inactive');
  if (hit?.access !== access) primeUserAccess(tenantId, access);
  return access;
}

/** Sign-in has just loaded the access; keep it so the first request does not load it again. */
export function primeUserAccess(tenantId: string, access: UserAccess): void {
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(keyOf(tenantId, access.userId, access.tokenVersion), { at: Date.now(), access });
}

/** Call after changing a user's roles on THIS instance; other instances catch up within TTL_MS. */
export function invalidateUserAccess(tenantId: string, userId: string): void {
  for (const key of cache.keys()) if (key.startsWith(`${tenantId}:${userId}:`)) cache.delete(key);
}
