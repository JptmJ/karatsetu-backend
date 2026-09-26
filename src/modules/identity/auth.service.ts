/**
 * Signing in.
 *
 * Passwords use scrypt from Node's own crypto module — deliberately memory-hard
 * and with no native dependency to compile, which keeps deploys boring.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import type { Tx } from '../../core/db/client.js';
import { asPlatform, transaction } from '../../core/db/client.js';
import { runWithContext } from '../../core/context/request-context.js';
import { env } from '../../core/config/env.js';
import { UnauthorizedError, ValidationError } from '../../core/errors/app-error.js';
import { newId } from '../../core/util/id.js';
import { effectiveGrants, invalidateUserAccess, loadUserAccess, resolveBranch, type BranchRef } from './access.service.js';

const scrypt = promisify(scryptCallback) as (p: string, s: Buffer, k: number) => Promise<Buffer>;
const KEY_LENGTH = 64;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH);
  const expected = Buffer.from(hashHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Kept deliberately small: permissions are resolved per request, not carried in the token. */
export interface AccessTokenClaims {
  sub: string;
  tenantId: string;
  tv: number;
}

export const signAccessToken = (claims: AccessTokenClaims): string =>
  jwt.sign(claims, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_TTL as never, issuer: 'karat-setu' });

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    return jwt.verify(token, env.JWT_SECRET, { issuer: 'karat-setu' }) as AccessTokenClaims;
  } catch {
    throw new UnauthorizedError('Your session has expired. Please sign in again.');
  }
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string | null; phone: string | null; fullName: string; branchId: string | null; mustChangePassword: boolean };
  tenant: { id: string; code: string; name: string; kind: string };
  roles: string[];
  permissions: string[];
  branches: BranchRef[];
}

/** Indian mobile numbers are stored as +91XXXXXXXXXX. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Finding the user has a chicken-and-egg problem: we need the tenant to scope
 * the query, but the tenant is what we are trying to work out. So this one
 * lookup runs at platform level, matching on tenant code + email/phone, and every
 * request after it is properly tenant-scoped.
 */
/** A new sign-in session: a fresh refresh-token family plus an access token. */
async function issueSession(
  tx: Tx, userId: string, tenantId: string, tokenVersion: number,
  meta: { userAgent?: string; ip?: string },
): Promise<{ accessToken: string; refreshToken: string }> {
  const refreshToken = randomBytes(48).toString('base64url');
  await tx.query(
    `insert into refresh_token (id, tenant_id, user_id, token_hash, expires_at, user_agent, ip_address, created_by, updated_by)
     values ($1, $2, $3, $4, now() + interval '30 days', $5, $6, $3, $3)`,
    [newId(), tenantId, userId, hashToken(refreshToken), meta.userAgent ?? null, meta.ip ?? null],
  );
  return { accessToken: signAccessToken({ sub: userId, tenantId, tv: tokenVersion }), refreshToken };
}

export async function login(
  tenantCode: string,
  identifier: string,
  password: string,
  meta: { userAgent?: string; ip?: string } = {},
): Promise<LoginResult> {
  const isEmail = identifier.includes('@');
  const found = await asPlatform(async (tx) =>
    tx.maybeOne<{
      id: string; tenant_id: string; email: string | null; full_name: string; password_hash: string;
      is_active: boolean; default_branch_id: string | null; locked_until: string | null;
      failed_login_count: number; phone: string | null; token_version: number;
      must_change_password: boolean; tenant_code: string; tenant_name: string;
      tenant_kind: string; tenant_status: string;
    }>(
      `select u.id, u.tenant_id, u.email, u.full_name, u.password_hash, u.is_active,
              u.default_branch_id, u.locked_until, u.failed_login_count, u.phone,
              u.token_version, u.must_change_password,
              t.code as tenant_code, t.display_name as tenant_name, t.kind as tenant_kind,
              t.status as tenant_status
         from app_user u
         join tenant t on t.id = u.tenant_id
        where lower(t.code) = lower($1) and ${isEmail ? 'u.email' : 'u.phone'} = $2
          and u.deleted_at is null and t.deleted_at is null`,
      [tenantCode, isEmail ? identifier.trim().toLowerCase() : normalizePhone(identifier)],
    ),
  );

  // Same message whichever part was wrong, so the response cannot be used to
  // discover which accounts exist.
  const rejection = new UnauthorizedError('Those sign-in details are not correct.');
  if (!found) {
    // Burn roughly the same time a real verification would take.
    await scrypt(password, randomBytes(16), KEY_LENGTH);
    throw rejection;
  }

  if (found.tenant_status === 'suspended' || found.tenant_status === 'closed') {
    throw new UnauthorizedError('This account is not active. Please contact support.');
  }
  if (!found.is_active) throw new UnauthorizedError('This user has been deactivated.');
  if (found.locked_until && new Date(found.locked_until) > new Date()) {
    throw new UnauthorizedError(`Too many failed attempts. Try again after ${LOCK_MINUTES} minutes.`);
  }

  const ok = await verifyPassword(password, found.password_hash);
  if (!ok) {
    await recordFailedLogin(found.id);
    throw rejection;
  }

  const context = {
    requestId: `login:${found.id.slice(0, 8)}`,
    tenantId: found.tenant_id,
    userId: found.id,
    branchId: found.default_branch_id,
    roles: [] as string[],
    permissions: new Set<string>(),
  };

  return runWithContext(context, async () =>
    transaction(async (tx) => {
      const access = await loadUserAccess(tx, found.id);
      if (!access || access.branches.length === 0) {
        throw new UnauthorizedError('No branch has been assigned to you yet. Please contact your administrator.');
      }
      const branchId = resolveBranch(access, undefined);
      const { roles, permissions } = effectiveGrants(access, branchId);

      await tx.query(
        `update app_user set last_login_at = now(), failed_login_count = 0, locked_until = null
          where id = $1`,
        [found.id],
      );

      const session = await issueSession(tx, found.id, found.tenant_id, found.token_version, meta);

      return {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        user: {
          id: found.id,
          email: found.email,
          phone: found.phone,
          fullName: found.full_name,
          branchId,
          mustChangePassword: found.must_change_password,
        },
        tenant: {
          id: found.tenant_id,
          code: found.tenant_code,
          name: found.tenant_name,
          kind: found.tenant_kind,
        },
        roles,
        permissions,
        branches: access.branches,
      };
    }),
  );
}

async function recordFailedLogin(userId: string): Promise<void> {
  await asPlatform(async (tx) => {
    await tx.query(
      `update app_user
          set failed_login_count = failed_login_count + 1,
              locked_until = case when failed_login_count + 1 >= $2
                                  then now() + ($3 || ' minutes')::interval else locked_until end
        where id = $1`,
      [userId, MAX_FAILED_LOGINS, String(LOCK_MINUTES)],
    );
  });
}

export async function refreshSession(
  refreshToken: string,
  meta: { userAgent?: string; ip?: string } = {},
): Promise<{ accessToken: string; refreshToken: string }> {
  const outcome = await asPlatform(async (tx) => {
    const row = await tx.maybeOne<{
      id: string; user_id: string; tenant_id: string; family_id: string; expires_at: string;
      revoked_at: string | null; replaced_by_id: string | null; token_version: number;
      is_active: boolean; user_deleted: boolean; locked_until: string | null;
      tenant_status: string;
    }>(
      `select rt.id, rt.user_id, rt.tenant_id, rt.family_id, rt.expires_at, rt.revoked_at, rt.replaced_by_id,
              u.token_version, u.is_active, (u.deleted_at is not null) as user_deleted,
              u.locked_until, t.status as tenant_status
         from refresh_token rt
         join app_user u on u.id = rt.user_id
         join tenant t on t.id = rt.tenant_id
        where rt.token_hash = $1
        for update of rt`,
      [hashToken(refreshToken)],
    );
    if (!row) return { ok: false as const };

    const revokeFamily = () =>
      tx.query(`update refresh_token set revoked_at = now() where family_id = $1 and revoked_at is null`, [row.family_id]);

    // An already-rotated token presented again means it was copied. Kill every session in its family.
    if (row.replaced_by_id) { await revokeFamily(); return { ok: false as const }; }
    if (row.revoked_at || new Date(row.expires_at) < new Date()) return { ok: false as const };

    const accountBlocked =
      !row.is_active || row.user_deleted ||
      (row.locked_until !== null && new Date(row.locked_until) > new Date()) ||
      row.tenant_status === 'suspended' || row.tenant_status === 'closed';
    if (accountBlocked) { await revokeFamily(); return { ok: false as const }; }

    const nextToken = randomBytes(48).toString('base64url');
    const nextId = newId();
    await tx.query(
      `insert into refresh_token (id, tenant_id, user_id, family_id, token_hash, expires_at, user_agent, ip_address, created_by, updated_by)
       values ($1, $2, $3, $4, $5, now() + interval '30 days', $6, $7, $3, $3)`,
      [nextId, row.tenant_id, row.user_id, row.family_id, hashToken(nextToken), meta.userAgent ?? null, meta.ip ?? null],
    );
    await tx.query(`update refresh_token set revoked_at = now(), replaced_by_id = $2 where id = $1`, [row.id, nextId]);

    return {
      ok: true as const,
      accessToken: signAccessToken({ sub: row.user_id, tenantId: row.tenant_id, tv: row.token_version }),
      refreshToken: nextToken,
    };
  });

  if (!outcome.ok) throw new UnauthorizedError('Your session has expired. Please sign in again.');
  return { accessToken: outcome.accessToken, refreshToken: outcome.refreshToken };
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await asPlatform(async (tx) => {
    await tx.query(`update refresh_token set revoked_at = now() where token_hash = $1`, [hashToken(refreshToken)]);
  });
}

/**
 * The signed-in user changes their own password. Ends every other session and
 * returns a fresh one, so this device stays signed in.
 */
export async function changeOwnPassword(
  currentPassword: string, newPassword: string, meta: { userAgent?: string; ip?: string } = {},
): Promise<{ accessToken: string; refreshToken: string }> {
  return transaction(async (tx) => {
    const userId = tx.context.userId!;
    const user = await tx.one<{ password_hash: string }>(
      `select password_hash from app_user where id = $1 for update`, [userId],
    );
    // 400, not 401 — a 401 would make the client try to refresh its token.
    if (!(await verifyPassword(currentPassword, user.password_hash))) {
      throw new ValidationError('Your current password is not correct.');
    }
    if (currentPassword === newPassword) throw new ValidationError('Choose a password different from your current one.');

    const updated = await tx.one<{ token_version: number }>(
      `update app_user
          set password_hash = $2, must_change_password = false, password_changed_at = now(),
              token_version = token_version + 1
        where id = $1
       returning token_version`,
      [userId, await hashPassword(newPassword)],
    );
    await tx.query(`update refresh_token set revoked_at = now() where user_id = $1 and revoked_at is null`, [userId]);
    invalidateUserAccess(tx.context.tenantId, userId);
    return issueSession(tx, userId, tx.context.tenantId, updated.token_version, meta);
  });
}
