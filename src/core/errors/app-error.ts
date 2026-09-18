/** Errors the API knows how to turn into a clean HTTP response. */

export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'validation_error', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Sign-in required') {
    super(message, 401, 'unauthorized');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do this') {
    super(message, 403, 'forbidden');
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(id ? `${resource} ${id} was not found` : `${resource} was not found`, 404, 'not_found');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'conflict', details);
  }
}

/** A rule of the business was broken — the request was understood but refused. */
export class BusinessRuleError extends AppError {
  constructor(message: string, code = 'business_rule', details?: unknown) {
    super(message, 422, code, details);
  }
}
