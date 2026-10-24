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
 */
function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    // `unsafe-eval` only in development, where the dev overlay and HMR need it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isDev ? "'unsafe-eval'" : ''}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://cdn.magicpatterns.com",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    "frame-src 'none'",
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
  const csp = contentSecurityPolicy(nonce, isDev)

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
