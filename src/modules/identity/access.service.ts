/**
 * Who may do what, where. Resolved per request (cached 60s per token version),
 * so a role change applies without waiting for the access token to expire.
 */
import type { Tx } from '../../core/db/client.js';
import { asTenant } from '../../core/db/client.js';
import { ForbiddenError, UnauthorizedError } from '../../core/errors/app-error.js';

export interface BranchRef { id: string; code: string; name: string }

export interface UserAccess {
  userId: string;
  tokenVersion: number;
  mustChangePassword: boolean;
  defaultBranchId: string | null;
  branches: BranchRef[];
  grants: { roleCode: string; branchId: string | null; permissions: string[] }[];
}

export async function loadUserAccess(tx: Tx, userId: string): Promise<UserAccess | null> {
  const user = await tx.maybeOne<{ token_version: number; default_branch_id: string | null; must_change_password: boolean }>(
    `select token_version, default_branch_id, must_change_password from app_user
      where id = $1 and is_active and deleted_at is null`,
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
    tokenVersion: user.token_version,
    mustChangePassword: user.must_change_password,
    defaultBranchId: user.default_branch_id,
    branches,
    grants: grants.map((g) => ({ roleCode: g.role_code, branchId: g.branch_id, permissions: g.permissions })),
  };
}

/** The branch this request runs in. A requested branch must be one the user holds a role at. */
export function resolveBranch(access: UserAccess, requested: string | undefined): string | null {
  if (requested) {
    if (!access.branches.some((b) => b.id === requested)) {
      throw new ForbiddenError('You do not have access to this branch.');
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

const TTL_MS = 60_000;
const MAX_ENTRIES = 5_000;
const cache = new Map<string, { at: number; access: UserAccess }>();

export async function getUserAccess(tenantId: string, userId: string, tokenVersion: number): Promise<UserAccess> {
  const key = `${tenantId}:${userId}:${tokenVersion}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.access;

  const access = await asTenant(tenantId, (tx) => loadUserAccess(tx, userId), userId);
  if (!access || access.tokenVersion !== tokenVersion) {
    throw new UnauthorizedError('Your session has expired. Please sign in again.');
  }

  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), access });
  return access;
}

/** Call after changing a user's roles on THIS instance; other instances catch up within TTL_MS. */
export function invalidateUserAccess(tenantId: string, userId: string): void {
  for (const key of cache.keys()) if (key.startsWith(`${tenantId}:${userId}:`)) cache.delete(key);
}
