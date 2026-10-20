/**
 * Shared-passphrase gate for a hosted demo.
 *
 * The demo sign-in page hands out an owner, partner or admin session with no
 * credential, which is the right affordance for a walkthrough and the wrong
 * thing to leave open on a public URL. Vercel's own password protection is a
 * paid feature, so the gate lives in the application instead.
 *
 * It is opt-in: with `ARC_DEMO_PASSPHRASE` unset there is no gate at all, which
 * is what local development, the test suites and `npm run dev` want. It is not
 * an authorisation mechanism — every role and tenant check behind it still
 * re-derives from the database — only a lock on the front door.
 */
export const GATE_COOKIE = 'arc_demo_gate'

/** The configured passphrase, or `undefined` when the gate is off. */
export function gatePassphrase(): string | undefined {
  const value = process.env.ARC_DEMO_PASSPHRASE
  return value && value.length > 0 ? value : undefined
}

/**
 * Derives the cookie value for a passphrase.
 *
 * Keyed with `AUTH_SECRET` so a leaked cookie cannot be attacked offline for
 * the passphrase itself. Uses WebCrypto rather than `node:crypto` because the
 * same function runs in middleware on the edge runtime.
 */
export async function gateToken(passphrase: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`demo-gate:${passphrase}`))

  let binary = ''
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Length-independent comparison, so a mismatch leaks no timing information. */
export function tokensMatch(presented: string | undefined, expected: string): boolean {
  if (!presented || presented.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i += 1) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Narrows a `?next=` value to a same-origin path, so the gate cannot be used
 * as an open redirect.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}
