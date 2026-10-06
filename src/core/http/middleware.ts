import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { ZodError, type ZodType } from 'zod';
import { runWithContext, type RequestContext } from '../context/request-context.js';
import { AppError, ForbiddenError, UnauthorizedError, ValidationError } from '../errors/app-error.js';
import { verifyAccessToken } from '../../modules/identity/auth.service.js';
import { verifyPlatformToken } from '../../modules/platform/platform-auth.service.js';
import { hasPermission } from '../../modules/identity/permissions.js';
import { logger } from '../util/logger.js';
import { isProduction } from '../config/env.js';

import { effectiveGrants, getUserAccess, resolveBranch, type UserAccess } from '../../modules/identity/access.service.js';
import { assertCanWrite, loadLiveSession, supportAccess } from '../../modules/platform/support-session.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare module 'express-serve-static-core' {
  interface Request {
    ctx?: RequestContext;
    accessInfo?: UserAccess;
  }
}

/** Gives every request an id, so a log line can be traced back to one call. */
export const requestId: RequestHandler = (req, res, next) => {
  const id = (req.headers['x-request-id'] as string) || randomUUID();
  res.setHeader('x-request-id', id);
  (req as Request & { requestId: string }).requestId = id;
  next();
};

/**
 * Which kind of token this is, read without verifying — only to pick the branch
 * that then verifies it properly. Routing on an unverified claim is safe
 * because nothing is trusted until the chosen branch has checked the signature.
 */
const peekScope = (token: string): string | undefined => {
  try {
    return (jwt.decode(token) as { scope?: string } | null)?.scope;
  } catch {
    return undefined;
  }
};

/**
 * A platform operator working inside a tenant through a support session.
 *
 * The session row is re-read on every request, so ending a session or letting
 * it lapse locks the operator out at once rather than whenever the token would
 * have expired. `userId` stays null: an operator has no `app_user` row, which is
 * exactly why this cannot reuse the tenant path.
 */
async function authenticateSupport(token: string, req: Request, next: NextFunction): Promise<void> {
  const session = await loadLiveSession(token);
  assertCanWrite(session, req.method);

  const rawBranch = (req.headers['x-branch-id'] as string | undefined)?.trim();
  if (rawBranch && !UUID_RE.test(rawBranch)) {
    return next(new ValidationError('X-Branch-Id must be a branch UUID, or left off entirely.'));
  }

  const access = await supportAccess(session);
  const branchId = rawBranch ?? access.defaultBranchId;

  const context: RequestContext = {
    requestId: (req as Request & { requestId: string }).requestId ?? randomUUID(),
    tenantId: session.tenantId,
    // No staff member did this. Audit rows carry the session id instead.
    userId: null,
    branchId,
    roles: ['support'],
    // Full reach inside the window — debugging a shop means seeing what they
    // see. Mutations are gated by `assertCanWrite`, not by permission strings.
    permissions: new Set(['*']),
    support: {
      sessionId: session.id, operatorId: session.operatorId,
      canWrite: session.canWrite, endsAt: session.endsAt,
    },
  };

  req.ctx = context;
  // `/api/me` and the services under it are built around a staff identity, so
  // the session supplies a stand-in rather than every one of them special-casing.
  req.accessInfo = access;
  runWithContext(context, () => next());
}

/**
 * Reads the token, builds the request context, and runs the rest of the request
 * inside it. From here on every database call is automatically tenant-scoped.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(new UnauthorizedError('Sign in to continue.'));

  const raw = header.slice(7);
  if (peekScope(raw) === 'support') {
    try {
      return await authenticateSupport(raw, req, next);
    } catch (err) {
      return next(err);
    }
  }

  try {
    const claims = verifyAccessToken(raw);
    const access = await getUserAccess(claims.tenantId, claims.sub, claims.tv);

    const rawBranch = (req.headers['x-branch-id'] as string | undefined)?.trim();
    if (rawBranch && !UUID_RE.test(rawBranch)) {
      return next(new ValidationError('X-Branch-Id must be a branch UUID, or left off entirely.'));
    }

    const branchId = resolveBranch(access, rawBranch);
    const { roles, permissions } = effectiveGrants(access, branchId);

    const path = req.originalUrl.split('?')[0];
    if (access.mustChangePassword && path !== '/api/me' && path !== '/api/me/password') {
      return next(new ForbiddenError('Please set a new password before continuing.', 'password_change_required'));
    }

    const context: RequestContext = {
      requestId: (req as Request & { requestId: string }).requestId ?? randomUUID(),
      tenantId: claims.tenantId,
      userId: claims.sub,
      branchId,
      roles,
      permissions: new Set(permissions),
    };

    req.ctx = context;
    req.accessInfo = access;
    runWithContext(context, () => next());
  } catch (err) {
    next(err);
  }
};

/** Gate a route behind a permission string, e.g. `trade.sales.create`. */
export const requirePermission =
  (permission: string): RequestHandler =>
  (req, _res, next) => {
    if (!req.ctx) return next(new UnauthorizedError());
    if (!hasPermission(req.ctx.permissions, permission)) {
      return next(new ForbiddenError(`You need the "${permission}" permission for this.`));
    }
    next();
  };

/** Validates body / query / params against a Zod schema and replaces them with the parsed value. */
export const validate =
  <B, Q, P>(schemas: { body?: ZodType<B>; query?: ZodType<Q>; params?: ZodType<P> }): RequestHandler =>
  (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) {
        // Express 5 exposes `req.query` as a getter on the prototype, so
        // assigning into it silently does nothing and the parsed defaults
        // never arrive. Shadowing it on the instance is what actually sticks.
        Object.defineProperty(req, 'query', {
          value: schemas.query.parse(req.query),
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
      if (schemas.params) Object.assign(req.params, schemas.params.parse(req.params));
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(
          new ValidationError(
            'Some fields need fixing.',
            error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          ),
        );
        return;
      }
      next(error);
    }
  };

/** Wraps an async handler so a rejected promise reaches the error handler. */
export const handler =
  <T>(fn: (req: Request, res: Response) => Promise<T>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/** Postgres error codes that have a good plain-English equivalent. */
const PG_MESSAGES: Record<string, { status: number; code: string; message: string }> = {
  '23505': { status: 409, code: 'duplicate', message: 'A record with these details already exists.' },
  '23503': { status: 409, code: 'in_use', message: 'That record is referenced elsewhere and cannot be removed.' },
  '23514': { status: 422, code: 'check_failed', message: 'One of the values is not allowed here.' },
  '23502': { status: 400, code: 'missing_field', message: 'A required field was left empty.' },
  '40001': { status: 409, code: 'busy', message: 'Someone else changed this at the same time. Please try again.' },
  '40P01': { status: 409, code: 'busy', message: 'Two operations collided. Please try again.' },
};

export const errorHandler = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const requestIdValue = res.getHeader('x-request-id');

  if (error instanceof AppError) {
    logger.warn({ err: error.message, code: error.code, path: req.path }, 'Request refused');
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details, requestId: requestIdValue },
    });
    return;
  }

  const pgCode = (error as { code?: string })?.code;
  const known = pgCode ? PG_MESSAGES[pgCode] : undefined;
  if (known) {
    const { column, table } = error as { column?: string; table?: string };
    logger.warn({ pgCode, path: req.path, table, column, detail: (error as { detail?: string }).detail }, 'Database rejected the request');
    res.status(known.status).json({
      error: {
        code: known.code,
        // Name the field, so the screen (and whoever reports it) knows exactly what is missing.
        message: pgCode === '23502' && column ? `${column.replace(/_id$/, '').replace(/_/g, ' ')} is missing${table ? ` (${table.replace(/_/g, ' ')})` : ''}.` : known.message,
        requestId: requestIdValue,
        ...(isProduction ? {} : { detail: (error as { detail?: string }).detail }),
      },
    });
    return;
  }

  logger.error({ err: error, path: req.path, method: req.method }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong on our side. The problem has been logged.',
      requestId: requestIdValue,
      ...(isProduction ? {} : { detail: error instanceof Error ? error.message : String(error) }),
    },
  });
};

/**
 * Express 5 types a route param as `string | string[] | undefined` because a
 * path can repeat a name. Every param in this app is a single value, already
 * checked by `validate`, so this narrows it in one place instead of at each
 * call site.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string') {
    throw new ValidationError(`Missing "${name}" in the URL.`);
  }
  return value;
}

/**
 * Authenticates a platform operator (super admin / support).
 *
 * Deliberately a different middleware from `authenticate`: a platform token has
 * no tenant, carries `scope: 'platform'`, and is signed with a different issuer.
 * Keeping them apart means a tenant token can never satisfy a platform route,
 * which is the one mistake in this area that would really matter.
 */
export const authenticatePlatform: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Sign in to continue.'));
  }

  let claims;
  try {
    claims = verifyPlatformToken(header.slice(7));
  } catch (error) {
    return next(error);
  }

  const context: RequestContext = {
    requestId: (req as Request & { requestId: string }).requestId ?? randomUUID(),
    // Platform work crosses tenants by definition; the sentinel keeps the
    // transaction helper happy while `bypassRls` does the real work.
    tenantId: '00000000-0000-0000-0000-000000000000',
    userId: null,
    branchId: null,
    roles: [claims.role],
    permissions: new Set(claims.permissions ?? []),
    bypassRls: true,
  };

  req.ctx = context;
  (req as Request & { platformUserId?: string }).platformUserId = claims.sub;
  runWithContext(context, () => next());
};

/** The signed-in platform operator's id. Throws if called off a platform route. */
export function platformUserId(req: Request): string {
  const id = (req as Request & { platformUserId?: string }).platformUserId;
  if (!id) throw new UnauthorizedError('This route requires a platform operator.');
  return id;
}
