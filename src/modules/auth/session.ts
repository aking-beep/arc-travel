import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getEnv } from '@/lib/env'

/**
 * Stateless, signed session cookie.
 *
 * Deliberately small: the POC has no password reset, no OAuth and no refresh
 * tokens. What it does have is a tamper-evident payload — the cookie carries
 * only a user id, and every authorisation decision is re-derived from the
 * database on each request (see modules/tenancy). A forged cookie therefore
 * cannot grant access that the database does not already record.
 */
export const SESSION_COOKIE = 'arc_session'
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12

interface SessionPayload {
  userId: string
  /** Seconds since epoch. */
  iat: number
  exp: number
}

function sign(value: string): string {
  return createHmac('sha256', getEnv().AUTH_SECRET).update(value).digest('base64url')
}

export function encodeSession(userId: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000)
  const payload: SessionPayload = { userId, iat, exp: iat + SESSION_MAX_AGE_SECONDS }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${sign(body)}`
}

export function decodeSession(token: string | undefined | null, now = Date.now()): string | null {
  if (!token) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null

  const body = token.slice(0, dot)
  const provided = token.slice(dot + 1)
  const expected = sign(body)

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
    if (typeof payload.userId !== 'string' || typeof payload.exp !== 'number') return null
    if (payload.exp * 1000 < now) return null
    return payload.userId
  } catch {
    return null
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: SESSION_MAX_AGE_SECONDS,
}
