/**
 * Domain error taxonomy. Every service throws one of these; the API layer maps
 * `status` straight onto the HTTP response so no handler has to guess.
 */
export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'CAPACITY_UNAVAILABLE'
  | 'HOLD_EXPIRED'
  | 'PRICE_CHANGED'
  | 'SAFETY_CONSTRAINT'
  | 'RATE_LIMITED'
  | 'DEMO_MODE_BLOCKED'
  | 'INTERNAL'

const STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  CAPACITY_UNAVAILABLE: 409,
  HOLD_EXPIRED: 410,
  PRICE_CHANGED: 409,
  SAFETY_CONSTRAINT: 422,
  RATE_LIMITED: 429,
  DEMO_MODE_BLOCKED: 403,
  INTERNAL: 500,
}

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = STATUS[code]
    this.details = details
  }
}

export const unauthenticated = (m = 'Sign in to continue.') => new AppError('UNAUTHENTICATED', m)
export const forbidden = (m = 'You do not have access to this resource.') =>
  new AppError('FORBIDDEN', m)
export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found.`)
export const invalid = (m: string, details?: unknown) =>
  new AppError('VALIDATION_FAILED', m, details)
export const conflict = (m: string, details?: unknown) => new AppError('CONFLICT', m, details)
export const capacityUnavailable = (m = 'That departure no longer has enough space.') =>
  new AppError('CAPACITY_UNAVAILABLE', m)
export const safetyConstraint = (m: string, details?: unknown) =>
  new AppError('SAFETY_CONSTRAINT', m, details)
export const rateLimited = (m = 'Too many requests. Try again shortly.') =>
  new AppError('RATE_LIMITED', m)

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError
}

/** Shape returned to clients. Never includes stack traces or raw DB errors. */
export interface ErrorPayload {
  error: { code: AppErrorCode; message: string; details?: unknown }
}

export function toErrorPayload(e: unknown): { status: number; body: ErrorPayload } {
  if (isAppError(e)) {
    return {
      status: e.status,
      body: { error: { code: e.code, message: e.message, details: e.details } },
    }
  }
  return {
    status: 500,
    body: { error: { code: 'INTERNAL', message: 'Something went wrong on our side.' } },
  }
}
