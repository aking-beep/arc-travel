import { headers } from 'next/headers'
import { isAppError } from '@/lib/errors'
import {
  guardPortalAttempt,
  recordPortalMiss,
  resolvePortalContext,
  type PortalContext,
} from '@/modules/guest/portal'

/**
 * Resolves a portal token for one HTTP request, rate-limited by caller.
 *
 * The limiting lives here rather than in the module because only the app layer
 * may read a request header, and the caller's address is the only thing a
 * guest-surface request can be keyed on: the token *is* the credential, so
 * there is no account to limit instead.
 *
 * Every entry point to the guest surface goes through this — the portal
 * layout, which runs on every page under it, and the server actions, which do
 * not run under the layout.
 */
export function clientKeyFromHeaders(headerList: Headers): string | null {
  const forwarded = headerList.get('x-forwarded-for')
  if (forwarded) {
    // The left-most entry is the original client; the rest are proxies.
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headerList.get('x-real-ip') ?? null
}

export async function resolvePortalForRequest(token: string): Promise<PortalContext> {
  const clientKey = clientKeyFromHeaders(await headers())
  await guardPortalAttempt(clientKey)

  try {
    return await resolvePortalContext(token)
  } catch (error) {
    // A miss is the signal worth counting: a guest holding a valid QR code
    // never produces one.
    if (isAppError(error) && error.code === 'NOT_FOUND') await recordPortalMiss(clientKey)
    throw error
  }
}
