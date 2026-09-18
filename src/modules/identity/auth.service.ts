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
import { UnauthorizedError } from '../../core/errors/app-error.js';
import { newId } from '../../core/util/id.js';

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

export interface AccessTokenClaims {
  sub: string;
  tenantId: string;
  branchId: string | null;
  roles: string[];
  permissions: string[];
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
  user: { id: string; email: string; fullName: string; branchId: string | null };
  tenant: { id: string; code: string; name: string; kind: string };
  roles: string[];
  permissions: string[];
}

/**
 * Finding the user has a chicken-and-egg problem: we need the tenant to scope
 * the query, but the tenant is what we are trying to work out. So this one
 * lookup runs at platform level, matching on tenant code + email, and every
 * request after it is properly tenant-scoped.
 */
export async function login(
  tenantCode: string,
  email: string,
  password: string,
  meta: { userAgent?: string; ip?: string } = {},
): Promise<LoginResult> {
  const found = await asPlatform(async (tx) =>
    tx.maybeOne<{
      id: string; tenant_id: string; email: string; full_name: string; password_hash: string;
      is_active: boolean; default_branch_id: string | null; locked_until: string | null;
      failed_login_count: number; tenant_code: string; tenant_name: string; tenant_kind: string;
      tenant_status: string;
    }>(
      `select u.id, u.tenant_id, u.email, u.full_name, u.password_hash, u.is_active,
              u.default_branch_id, u.locked_until, u.failed_login_count,
              t.code as tenant_code, t.display_name as tenant_name, t.kind as tenant_kind,
              t.status as tenant_status
         from app_user u
         join tenant t on t.id = u.tenant_id
        where lower(t.code) = lower($1) and lower(u.email) = lower($2)
          and u.deleted_at is null and t.deleted_at is null`,
      [tenantCode, email],
    ),
  );

  // Same message whichever part was wrong, so the response cannot be used to
  // discover which email addresses exist.
  const rejection = new UnauthorizedError('That email or password is not correct.');
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
    await recordFailedLogin(found.tenant_id, found.id, found.failed_login_count + 1);
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
      const roleRows = await tx.query<{ code: string; permissions: string[] }>(
        `select r.code, r.permissions
           from user_role ur join role r on r.id = ur.role_id
          where ur.user_id = $1`,
        [found.id],
      );

      const roles = roleRows.map((r) => r.code);
      const permissions = [...new Set(roleRows.flatMap((r) => r.permissions ?? []))];

      await tx.query(
        `update app_user set last_login_at = now(), failed_login_count = 0, locked_until = null
          where id = $1`,
        [found.id],
      );

      const refreshToken = randomBytes(48).toString('base64url');
      await tx.query(
        `insert into refresh_token (id, tenant_id, user_id, token_hash, expires_at, user_agent, ip_address, created_by, updated_by)
         values ($1, $2, $3, $4, now() + interval '30 days', $5, $6, $3, $3)`,
        [newId(), found.tenant_id, found.id, hashToken(refreshToken), meta.userAgent ?? null, meta.ip ?? null],
      );

      return {
        accessToken: signAccessToken({
          sub: found.id,
          tenantId: found.tenant_id,
          branchId: found.default_branch_id,
          roles,
          permissions,
        }),
        refreshToken,
        user: {
          id: found.id,
          email: found.email,
          fullName: found.full_name,
          branchId: found.default_branch_id,
        },
        tenant: {
          id: found.tenant_id,
          code: found.tenant_code,
          name: found.tenant_name,
          kind: found.tenant_kind,
        },
        roles,
        permissions,
      };
    }),
  );
}

async function recordFailedLogin(tenantId: string, userId: string, attempts: number): Promise<void> {
  await asPlatform(async (tx) => {
    await tx.query(
      `update app_user
          set failed_login_count = $2,
              locked_until = case when $2 >= $3 then now() + ($4 || ' minutes')::interval else locked_until end
        where id = $1`,
      [userId, attempts, MAX_FAILED_LOGINS, String(LOCK_MINUTES)],
    );
  });
}

export async function refreshSession(refreshToken: string): Promise<{ accessToken: string }> {
  const row = await asPlatform(async (tx) =>
    tx.maybeOne<{
      user_id: string; tenant_id: string; default_branch_id: string | null; expires_at: string; revoked_at: string | null;
    }>(
      `select rt.user_id, rt.tenant_id, rt.expires_at, rt.revoked_at, u.default_branch_id
         from refresh_token rt join app_user u on u.id = rt.user_id
        where rt.token_hash = $1`,
      [hashToken(refreshToken)],
    ),
  );

  if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) {
    throw new UnauthorizedError('Your session has expired. Please sign in again.');
  }

  const context = {
    requestId: 'refresh',
    tenantId: row.tenant_id,
    userId: row.user_id,
    branchId: row.default_branch_id,
    roles: [] as string[],
    permissions: new Set<string>(),
  };

  return runWithContext(context, async () =>
    transaction(async (tx) => {
      const roleRows = await tx.query<{ code: string; permissions: string[] }>(
        `select r.code, r.permissions from user_role ur join role r on r.id = ur.role_id where ur.user_id = $1`,
        [row.user_id],
      );
      return {
        accessToken: signAccessToken({
          sub: row.user_id,
          tenantId: row.tenant_id,
          branchId: row.default_branch_id,
          roles: roleRows.map((r) => r.code),
          permissions: [...new Set(roleRows.flatMap((r) => r.permissions ?? []))],
        }),
      };
    }),
  );
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await asPlatform(async (tx) => {
    await tx.query(`update refresh_token set revoked_at = now() where token_hash = $1`, [hashToken(refreshToken)]);
  });
}
