import { NextResponse, type NextRequest } from 'next/server'
import { GATE_COOKIE, gatePassphrase, gateToken, tokensMatch } from '@/lib/demo-gate'

/**
 * Holds the hosted demo behind a shared passphrase when one is configured. With
 * `ARC_DEMO_PASSPHRASE` unset this is a pass-through, so nothing changes for
 * local development or the test suites.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const passphrase = gatePassphrase()
  if (!passphrase) return NextResponse.next()

  const expected = await gateToken(passphrase, process.env.AUTH_SECRET ?? '')
  if (tokensMatch(request.cookies.get(GATE_COOKIE)?.value, expected)) {
    return NextResponse.next()
  }

  const url = request.nextUrl.clone()
  url.pathname = '/gate'
  url.search = ''
  url.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`)
  return NextResponse.redirect(url)
}

export const config = {
  // Everything except the gate itself and the assets the gate page needs to
  // render. Nothing below is tenant data.
  matcher: ['/((?!gate$|gate/|_next/static|_next/image|icon|favicon|manifest).*)'],
}
