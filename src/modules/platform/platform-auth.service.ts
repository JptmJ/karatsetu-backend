/**
 * Super admin sign-in.
 *
 * Separate from tenant sign-in on purpose: a platform operator has no tenant
 * code to give, and the token they receive carries different claims. Keeping
 * the two flows apart means a tenant token can never accidentally satisfy a
 * platform permission check, and vice versa.
 */
import { randomBytes, createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { asPlatform } from '../../core/db/client.js';
import { env } from '../../core/config/env.js';
import { UnauthorizedError } from '../../core/errors/app-error.js';
import { newId } from '../../core/util/id.js';
import { hashPassword, verifyPassword } from '../identity/auth.service.js';
import { SUPER_ADMIN, type PlatformRoleCode } from './roles.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export interface PlatformClaims {
  sub: string;
  /** Marks this as a platform token. Tenant middleware refuses it, and vice versa. */
  scope: 'platform';
  role: PlatformRoleCode;
  permissions: string[];
}

export const signPlatformToken = (claims: PlatformClaims): string =>
  jwt.sign(claims, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_TTL as never, issuer: 'ratnagrid-platform' });

export function verifyPlatformToken(token: string): PlatformClaims {
  try {
    const claims = jwt.verify(token, env.JWT_SECRET, { issuer: 'ratnagrid-platform' }) as PlatformClaims;
    if (claims.scope !== 'platform') throw new Error('not a platform token');
    return claims;
  } catch {
    throw new UnauthorizedError('Your session has expired. Please sign in again.');
  }
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface PlatformLoginResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; fullName: string; role: PlatformRoleCode; roleName: string };
  permissions: string[];
}

export async function platformLogin(
  email: string,
  password: string,
  meta: { userAgent?: string; ip?: string } = {},
): Promise<PlatformLoginResult> {
  const rejection = new UnauthorizedError('That email or password is not correct.');

  return asPlatform(async (tx) => {
    const user = await tx.maybeOne<{
      id: string; email: string; full_name: string; password_hash: string;
      role: PlatformRoleCode; is_active: boolean; locked_until: string | null; failed_login_count: number;
    }>(
      `select id, email, full_name, password_hash, role, is_active, locked_until, failed_login_count
         from platform_user where lower(email) = lower($1) and deleted_at is null`,
      [email],
    );

    if (!user) {
      // Spend roughly the same time a real check would, so the response time
      // does not reveal which addresses exist.
      await hashPassword(password);
      throw rejection;
    }
    if (!user.is_active) throw new UnauthorizedError('This account has been deactivated.');
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new UnauthorizedError(`Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`);
    }

    if (!(await verifyPassword(password, user.password_hash))) {
      const attempts = user.failed_login_count + 1;
      await tx.query(
        `update platform_user
            set failed_login_count = $2,
                locked_until = case when $2 >= $3 then now() + ($4 || ' minutes')::interval else locked_until end
          where id = $1`,
        [user.id, attempts, MAX_FAILED, String(LOCK_MINUTES)],
      );
      throw rejection;
    }

    const permissions = [...SUPER_ADMIN.permissions];

    await tx.query(
      `update platform_user set last_login_at = now(), failed_login_count = 0, locked_until = null where id = $1`,
      [user.id],
    );

    const refreshToken = randomBytes(48).toString('base64url');
    await tx.query(
      `insert into platform_refresh_token (id, platform_user_id, token_hash, expires_at, user_agent, ip_address)
       values ($1, $2, $3, now() + interval '30 days', $4, $5)`,
      [newId(), user.id, hashToken(refreshToken), meta.userAgent ?? null, meta.ip ?? null],
    );

    await audit(tx, user.id, 'platform.login', { ip: meta.ip });

    return {
      accessToken: signPlatformToken({ sub: user.id, scope: 'platform', role: user.role, permissions }),
      refreshToken,
      user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role, roleName: SUPER_ADMIN.name },
      permissions,
    };
  });
}

export async function platformRefresh(refreshToken: string): Promise<{ accessToken: string }> {
  return asPlatform(async (tx) => {
    const row = await tx.maybeOne<{ platform_user_id: string; role: PlatformRoleCode; expires_at: string; revoked_at: string | null; is_active: boolean }>(
      `select rt.platform_user_id, rt.expires_at, rt.revoked_at, u.role, u.is_active
         from platform_refresh_token rt join platform_user u on u.id = rt.platform_user_id
        where rt.token_hash = $1`,
      [hashToken(refreshToken)],
    );
    if (!row || row.revoked_at || !row.is_active || new Date(row.expires_at) < new Date()) {
      throw new UnauthorizedError('Your session has expired. Please sign in again.');
    }
    return {
      accessToken: signPlatformToken({
        sub: row.platform_user_id, scope: 'platform', role: row.role,
        permissions: [...SUPER_ADMIN.permissions],
      }),
    };
  });
}

export async function platformLogout(refreshToken: string): Promise<void> {
  await asPlatform(async (tx) => {
    await tx.query(`update platform_refresh_token set revoked_at = now() where token_hash = $1`, [hashToken(refreshToken)]);
  });
}

/** Writes to the platform audit log. Every super-admin action should call this. */
export async function audit(
  tx: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  platformUserId: string | null,
  action: string,
  details: { tenantId?: string; targetType?: string; targetId?: string; changes?: unknown; ip?: string } = {},
): Promise<void> {
  await tx.query(
    `insert into platform_audit_log (id, platform_user_id, action, target_tenant_id, target_type, target_id, changes, ip_address)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      newId(), platformUserId, action, details.tenantId ?? null,
      details.targetType ?? null, details.targetId ?? null,
      details.changes ? JSON.stringify(details.changes) : null, details.ip ?? null,
    ],
  );
}
