import { NextResponse, type NextRequest } from 'next/server'
import { GATE_COOKIE, gatePassphrase, gateToken, tokensMatch } from '@/lib/demo-gate'

/**
 * Two jobs, in this order: set the security headers that have to be set per
 * request, then hold the hosted demo behind a shared passphrase when one is
 * configured.
 *
 * ## Content-Security-Policy
 *
 * The static headers live in `next.config.ts`. A CSP cannot, because a useful
 * one carries a per-request nonce: without it the only way to allow Next's own
 * inline bootstrap scripts is `'unsafe-inline'`, which allows every injected
 * script too and makes the policy decorative.
 *
 * So a nonce is minted here and set on both the request and the response.
 * Next reads the policy off the *request* header to stamp the same nonce onto
 * the scripts it emits, which is why it has to be on both.
 *
 * `'strict-dynamic'` lets a nonced script load the chunks it needs without
 * every chunk URL being enumerated. `style-src` keeps `'unsafe-inline'`:
 * React sets inline styles and Tailwind's preflight is injected, and a
 * style-only injection is not the threat the policy is for. `img-src` names
 * the Magic Patterns CDN explicitly, the same host `next.config.ts` allows the
 * optimiser to fetch from.
 *
 * ## Stripe's hosts are allowed only when a live payment provider is set
 *
 * Collecting a card means loading a script from `js.stripe.com` and letting it
 * open an iframe from the same origin — that iframe is what keeps the card
 * number out of ARC's reach, so there is no version of this that does not
 * widen the policy.
 *
 * It is widened conditionally. The hosted demo takes no payments, renders no
 * payment form, and gets the tighter policy it had before: `frame-src 'none'`
 * and no third-party script origin. Allowing Stripe everywhere "because the
 * pilot will need it" would mean every demo deployment carried a script source
 * and a frame source it never uses, which is the kind of default nobody
 * revisits.
 *
 * Read from `process.env` rather than `getEnv()`: this runs in the edge
 * runtime, where the Zod parse and its database-url resolution do not belong.
 * A value other than `stripe` simply leaves the policy tight, which is the
 * safe direction to fail in.
 */
const STRIPE_SCRIPT = 'https://js.stripe.com'
const STRIPE_API = 'https://api.stripe.com'

export function contentSecurityPolicy(
  nonce: string,
  isDev: boolean,
  options: { allowStripe: boolean },
): string {
  const { allowStripe } = options
  const directives = [
    "default-src 'self'",
    // `unsafe-eval` only in development, where the dev overlay and HMR need it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${allowStripe ? STRIPE_SCRIPT : ''} ${isDev ? "'unsafe-eval'" : ''}`
      .replace(/\s+/g, ' ')
      .trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://cdn.magicpatterns.com",
    "font-src 'self' data:",
    `connect-src 'self'${allowStripe ? ` ${STRIPE_API} ${STRIPE_SCRIPT}` : ''}${isDev ? ' ws: wss:' : ''}`,
    // The card fields live in an iframe Stripe serves. Nothing else may frame.
    allowStripe ? `frame-src ${STRIPE_SCRIPT}` : "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
  ]
  if (!isDev) directives.push('upgrade-insecure-requests')
  return directives.join('; ')
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const isDev = process.env.NODE_ENV !== 'production'
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = contentSecurityPolicy(nonce, isDev, {
    allowStripe: process.env.PAYMENTS_PROVIDER === 'stripe',
  })

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('content-security-policy', csp)

  const withHeaders = (response: NextResponse): NextResponse => {
    response.headers.set('content-security-policy', csp)
    return response
  }

  const passphrase = gatePassphrase()
  if (!passphrase) {
    return withHeaders(NextResponse.next({ request: { headers: requestHeaders } }))
  }

  const expected = await gateToken(passphrase, process.env.AUTH_SECRET ?? '')
  if (tokensMatch(request.cookies.get(GATE_COOKIE)?.value, expected)) {
    return withHeaders(NextResponse.next({ request: { headers: requestHeaders } }))
  }

  const url = request.nextUrl.clone()
  url.pathname = '/gate'
  url.search = ''
  url.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`)
  return withHeaders(NextResponse.redirect(url))
}

export const config = {
  // Everything except the gate itself and the assets the gate page needs to
  // render. Nothing below is tenant data.
  matcher: ['/((?!gate$|gate/|_next/static|_next/image|icon|favicon|manifest).*)'],
}
