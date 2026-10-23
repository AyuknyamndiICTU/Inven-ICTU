import type { Problem } from '@labpass/contracts';

/** Application error rendered as RFC 9457 problem+json by the global filter. `code` is stable for clients. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly title: string,
    public readonly detail?: string,
    public readonly extensions?: Record<string, unknown>,
    public readonly errors?: Problem['errors'],
    public readonly headers?: Record<string, string>,
  ) {
    super(detail ?? title);
    this.name = 'AppError';
  }

  toProblem(instance?: string): Problem {
    return {
      type: `https://labpass.ictuniversity.edu.cm/problems/${this.code.toLowerCase().replace(/_/g, '-')}`,
      title: this.title,
      status: this.status,
      code: this.code,
      ...(this.detail ? { detail: this.detail } : {}),
      ...(instance ? { instance } : {}),
      ...(this.errors ? { errors: this.errors } : {}),
      ...(this.extensions ? { extensions: this.extensions } : {}),
    };
  }
}

export const Errors = {
  validation: (errors: Problem['errors'], detail = 'The request is invalid.') =>
    new AppError(400, 'VALIDATION_FAILED', 'Invalid request', detail, undefined, errors),
  badRequest: (code: string, detail: string, extensions?: Record<string, unknown>) =>
    new AppError(400, code, 'Bad request', detail, extensions),
  unauthenticated: (detail = 'Authentication is required.') =>
    new AppError(401, 'UNAUTHENTICATED', 'Not signed in', detail),
  forbidden: (code: string, detail: string, extensions?: Record<string, unknown>) =>
    new AppError(403, code, 'Forbidden', detail, extensions),
  notFound: (what: string) => new AppError(404, 'NOT_FOUND', 'Not found', `${what} was not found.`),
  conflict: (code: string, detail: string, extensions?: Record<string, unknown>) =>
    new AppError(409, code, 'Conflict', detail, extensions),
  unprocessable: (code: string, detail: string, extensions?: Record<string, unknown>) =>
    new AppError(422, code, 'Unprocessable', detail, extensions),
  locked: (detail: string, retryAfterSec: number) =>
    new AppError(423, 'LOCKED', 'Temporarily locked', detail, { retryAfterSec }, undefined, {
      'Retry-After': String(retryAfterSec),
    }),
  tooMany: (retryAfterSec: number) =>
    new AppError(429, 'RATE_LIMITED', 'Too many requests', 'Please wait and try again.', { retryAfterSec }, undefined, {
      'Retry-After': String(retryAfterSec),
    }),
  unavailable: (detail: string) => new AppError(503, 'UNAVAILABLE', 'Service unavailable', detail),
};
