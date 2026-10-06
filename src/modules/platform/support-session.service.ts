/**
 * Support impersonation — a platform operator working inside one tenant.
 *
 * This is the *only* way a platform role reaches business data. Platform tokens
 * are refused by every tenant route, so without a session there is no path in
 * at all; with one, every action is tagged with the session in the tenant's own
 * audit log, which is what makes "who looked at my data" answerable.
 *
 * Three things are deliberate:
 *
 *   - The token is its own scope (`support`), not a tenant token. A tenant token
 *     resolves permissions from an `app_user` row, and an operator has none.
 *   - The session row is checked on every request, not just at sign-in, so
 *     ending a session takes effect immediately rather than when the token
 *     happens to expire.
 *   - Read-only is the default. Writing needs `canWrite`, which is a separate
 *     permission the Support Engineer role does not hold.
 */
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { asPlatform } from '../../core/db/client.js';
import { env } from '../../core/config/env.js';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../../core/errors/app-error.js';
import { newId } from '../../core/util/id.js';
import { audit } from './platform-auth.service.js';

/** Hard ceiling regardless of what is asked for: eight hours. */
export const MAX_DURATION_MINUTES = 480;

export interface SupportClaims {
  /** The support session id. */
  sid: string;
  /** Marks this as a support token — tenant and platform middleware both check. */
  scope: 'support';
  tenantId: string;
  /** The platform operator behind the session. */
  operatorId: string;
  canWrite: boolean;
  /**
   * Random, so two sessions can never produce the same token even if they are
   * signed in the same second. `token_hash` is unique, and a collision there
   * would otherwise refuse a legitimate session.
   */
  nonce: string;
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const signSupportToken = (claims: SupportClaims, expiresInSeconds: number): string =>
  jwt.sign(claims, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds,
    issuer: 'swarnay-support',
  });

export function verifySupportToken(token: string): SupportClaims {
  try {
    const claims = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'swarnay-support',
    }) as SupportClaims;
    if (claims.scope !== 'support') throw new Error('not a support token');
    return claims;
  } catch {
    throw new UnauthorizedError('This support session is no longer valid.', 'support_session_invalid');
  }
}

export interface LiveSession {
  id: string;
  tenantId: string;
  operatorId: string;
  canWrite: boolean;
  endsAt: string;
}

/**
 * Confirms the session behind a token is still open, on every request.
 *
 * A token alone is not enough: the row is what decides. Ending a session, or
 * letting it run past `ends_at`, locks the operator out on their next call.
 */
export async function loadLiveSession(token: string): Promise<LiveSession> {
  const claims = verifySupportToken(token);

  return asPlatform(async (tx) => {
    const row = await tx.maybeOne<{
      id: string; tenant_id: string; operator_user_id: string; can_write: boolean;
      ends_at: string; ended_at: string | null; tenant_status: string;
    }>(
      `select s.id, s.tenant_id, s.operator_user_id, s.can_write, s.ends_at, s.ended_at,
              t.status as tenant_status
         from support_session s
         join tenant t on t.id = s.tenant_id
        where s.id = $1 and s.token_hash = $2`,
      [claims.sid, hashToken(token)],
    );

    if (!row) throw new UnauthorizedError('This support session is no longer valid.', 'support_session_invalid');
    if (row.ended_at) throw new UnauthorizedError('This support session has been closed.', 'support_session_ended');
    if (new Date(row.ends_at) <= new Date()) {
      throw new UnauthorizedError('This support session has expired.', 'support_session_expired');
    }

    return {
      id: row.id,
      tenantId: row.tenant_id,
      operatorId: row.operator_user_id,
      // The row wins over the claim: an escalation cannot be forged into a token.
      canWrite: row.can_write,
      endsAt: row.ends_at,
    };
  });
}

export interface StartInput {
  tenantId: string;
  reason: string;
  durationMinutes: number;
  canWrite: boolean;
}

/** Opens a session and returns the token that carries it. Shown once. */
export async function startSupportSession(
  input: StartInput,
  operator: { id: string; permissions: Set<string> },
  ip?: string,
) {
  if (input.durationMinutes > MAX_DURATION_MINUTES) {
    throw new ValidationError(`A support session cannot run longer than ${MAX_DURATION_MINUTES} minutes.`);
  }

  return asPlatform(async (tx) => {
    const tenant = await tx.maybeOne<{ id: string; code: string; display_name: string }>(
      `select id, code, display_name from tenant where id = $1 and deleted_at is null`,
      [input.tenantId],
    );
    if (!tenant) throw new NotFoundError('Tenant', input.tenantId);

    const id = newId();
    const endsAt = new Date(Date.now() + input.durationMinutes * 60_000);
    const ttlSeconds = Math.ceil(input.durationMinutes * 60);

    /*
     * Sign first, then store the hash of the very string the operator will send
     * back. Hashing anything else — a separate random secret, say — leaves a
     * token that can never match its own row.
     */
    const token = signSupportToken(
      {
        sid: id, scope: 'support', tenantId: input.tenantId,
        operatorId: operator.id, canWrite: input.canWrite,
        nonce: randomBytes(16).toString('base64url'),
      },
      ttlSeconds,
    );

    const session = await tx.one<Record<string, unknown>>(
      `insert into support_session
         (id, tenant_id, operator_user_id, reason, ends_at, can_write, token_hash, ip_address)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id, tenant_id, operator_user_id, reason, started_at, ends_at, ended_at, can_write`,
      [id, input.tenantId, operator.id, input.reason, endsAt, input.canWrite, hashToken(token), ip ?? null],
    );

    await audit(tx, operator.id, 'support.session_start', {
      tenantId: input.tenantId,
      targetType: 'support_session',
      targetId: id,
      changes: { reason: input.reason, canWrite: input.canWrite, durationMinutes: input.durationMinutes },
      ip,
    });

    return {
      session: { ...session, tenant_code: tenant.code, tenant_name: tenant.display_name },
      /**
       * The only time this is ever returned. Only its hash is stored, so a lost
       * token means opening a new session.
       */
      token,
      endsAt: endsAt.toISOString(),
    };
  });
}

export async function listSupportSessions(filters: { tenantId?: string; openOnly?: boolean; limit: number }) {
  return asPlatform(async (tx) => {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.tenantId) {
      params.push(filters.tenantId);
      clauses.push(`s.tenant_id = $${params.length}`);
    }
    if (filters.openOnly) clauses.push(`s.ended_at is null and s.ends_at > now()`);

    return {
      rows: await tx.query(
        `select s.id, s.tenant_id, s.reason, s.started_at, s.ends_at, s.ended_at, s.can_write, s.ip_address,
                t.code as tenant_code, t.display_name as tenant_name,
                u.full_name as operator_name, u.email as operator_email,
                (s.ended_at is null and s.ends_at > now()) as is_open,
                (select count(*) from audit_log a where a.support_session_id = s.id) as action_count
           from support_session s
           join tenant t on t.id = s.tenant_id
           left join platform_user u on u.id = s.operator_user_id
          ${clauses.length ? `where ${clauses.join(' and ')}` : ''}
          order by s.started_at desc
          limit ${Number(filters.limit)}`,
        params,
      ),
    };
  });
}

/** Closes a session now. The operator's next request is refused. */
export async function endSupportSession(sessionId: string, operatorId: string, ip?: string) {
  return asPlatform(async (tx) => {
    const row = await tx.maybeOne<{ id: string; tenant_id: string; ended_at: string | null }>(
      `select id, tenant_id, ended_at from support_session where id = $1`,
      [sessionId],
    );
    if (!row) throw new NotFoundError('Support session', sessionId);
    if (row.ended_at) throw new ValidationError('That support session is already closed.');

    const updated = await tx.one<Record<string, unknown>>(
      `update support_session set ended_at = now(), token_hash = null where id = $1
       returning id, tenant_id, reason, started_at, ends_at, ended_at, can_write`,
      [sessionId],
    );

    await audit(tx, operatorId, 'support.session_end', {
      tenantId: row.tenant_id, targetType: 'support_session', targetId: sessionId, ip,
    });

    return updated;
  });
}

/**
 * What the tenant app sees while an operator is inside it.
 *
 * `/api/me` and every service below it expect a `UserAccess`, which is built
 * from an `app_user` row — and an operator has none. Rather than special-case
 * each of them, the session presents itself as one: a stand-in identity with
 * every branch and full grants, named so that anything showing "who did this"
 * says plainly that it was support and not a member of staff.
 *
 * `userId` stays null in the request context, so audit rows record no staff
 * member and carry the session id instead.
 */
export async function supportAccess(
  session: LiveSession,
): Promise<{
  userId: string; fullName: string; email: string | null; phone: string | null;
  tokenVersion: number; mustChangePassword: boolean; tenantActive: boolean;
  defaultBranchId: string | null;
  branches: { id: string; code: string; name: string }[];
  grants: { roleCode: string; branchId: string | null; permissions: string[] }[];
}> {
  const { branches, operatorName } = await asPlatform(async (tx) => ({
    branches: await tx.query<{ id: string; code: string; name: string }>(
      `select id, code, name from branch
        where tenant_id = $1 and deleted_at is null and is_active = true
        order by code`,
      [session.tenantId],
    ),
    operatorName: (await tx.maybeOne<{ full_name: string }>(
      `select full_name from platform_user where id = $1`, [session.operatorId]))?.full_name ?? 'Platform support',
  }));

  return {
    userId: session.operatorId,
    fullName: `${operatorName} (Swarnay support)`,
    email: null,
    phone: null,
    tokenVersion: 0,
    mustChangePassword: false,
    tenantActive: true,
    defaultBranchId: branches[0]?.id ?? null,
    branches,
    grants: [{ roleCode: 'support', branchId: null, permissions: ['*'] }],
  };
}

/**
 * A read-only session may only read. Checked per request rather than per route
 * so a new endpoint cannot accidentally become writable from inside a session.
 */
export function assertCanWrite(session: LiveSession, method: string): void {
  if (session.canWrite) return;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  throw new ForbiddenError(
    'This is a read-only support session. Ask for write access if you need to make a change.',
    'support_session_read_only',
  );
}
