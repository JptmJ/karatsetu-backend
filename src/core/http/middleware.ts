import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError, type ZodType } from 'zod';
import { runWithContext, type RequestContext } from '../context/request-context.js';
import { AppError, ForbiddenError, UnauthorizedError, ValidationError } from '../errors/app-error.js';
import { verifyAccessToken } from '../../modules/identity/auth.service.js';
import { verifyPlatformToken } from '../../modules/platform/platform-auth.service.js';
import { hasPermission } from '../../modules/identity/permissions.js';
import { logger } from '../util/logger.js';
import { isProduction } from '../config/env.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare module 'express-serve-static-core' {
  interface Request {
    ctx?: RequestContext;
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
 * Reads the token, builds the request context, and runs the rest of the request
 * inside it. From here on every database call is automatically tenant-scoped.
 */
export const authenticate: RequestHandler = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Sign in to continue.'));
  }

  const claims = verifyAccessToken(header.slice(7));

  /*
   * A branch may be switched per request via X-Branch-Id.
   *
   * A blank header means "no branch", not "the branch whose id is empty" —
   * API clients send an empty header whenever the variable behind it is unset,
   * and letting that through reached the database as an invalid uuid and came
   * back as a 500. A malformed value is a client mistake, so it gets a 400 that
   * says what is wrong.
   */
  const rawBranch = (req.headers['x-branch-id'] as string | undefined)?.trim();
  let requestedBranch: string | undefined;
  if (rawBranch) {
    if (!UUID_RE.test(rawBranch)) {
      return next(new ValidationError('X-Branch-Id must be a branch UUID, or left off entirely.'));
    }
    requestedBranch = rawBranch;
  }

  const context: RequestContext = {
    requestId: (req as Request & { requestId: string }).requestId ?? randomUUID(),
    tenantId: claims.tenantId,
    userId: claims.sub,
    branchId: requestedBranch ?? claims.branchId,
    roles: claims.roles ?? [],
    permissions: new Set(claims.permissions ?? []),
  };

  req.ctx = context;
  runWithContext(context, () => next());
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
    logger.warn({ pgCode, path: req.path, detail: (error as { detail?: string }).detail }, 'Database rejected the request');
    res.status(known.status).json({
      error: {
        code: known.code,
        message: known.message,
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
