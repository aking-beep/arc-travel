import Link from 'next/link'
import { KeyRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DemoBanner } from '@/components/demo-banner'
import { signInAction } from '@/app/actions'
import { listDemoAccounts } from '@/modules/auth/service'
import { isDemoMode } from '@/lib/env'
import { safeNext } from '@/lib/demo-gate'
import { CredentialsForm } from './credentials-form'

export const metadata = { title: 'Sign in' }

/**
 * Sign in.
 *
 * Two halves, and the order matters. The password form is the product: a
 * credential the person set themselves, checked against a scrypt hash, with
 * guessing bounded per account and per caller.
 *
 * Below it, and only while `ARC_DATA_MODE=demo`, the account switcher — the
 * seeded accounts have no passwords, because inventing credentials for
 * synthetic people would only create something to leak.
 *
 * ADR-023 had this whole page 404 outside demo mode, which was right when the
 * switcher was all there was: a public page that signed anyone in as any role.
 * Now that real credentials exist the page has to be reachable, so the
 * *switcher* is gated instead of the route. It still lists no portal tokens.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>
}) {
  const { next, reset } = await searchParams
  // `safeNext`, not a local `startsWith('/')` check: the weaker form admitted
  // `//evil.example.com`, which the browser treats as an absolute URL.
  const target = safeNext(next)

  // The switcher is a demo affordance and must not exist anywhere else: it
  // signs anyone in as any role with no credential.
  const demoMode = isDemoMode()
  const accounts = demoMode ? await listDemoAccounts() : []

  const groups = [
    { role: 'OWNER', label: 'Hotel owner', note: 'Full access to Casa Olas and its catalog.' },
    { role: 'STAFF', label: 'Front desk', note: 'Scoped to one property.' },
    { role: 'SUPPLIER', label: 'Local partners', note: 'Each sees only their own experiences.' },
    { role: 'ADMIN', label: 'Platform admin', note: 'Verification and system health.' },
  ] as const

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
        <div className="flex items-center gap-2">
          <KeyRound className="text-jade-700 size-5" aria-hidden />
          <h1 className="font-display text-2xl font-semibold">Sign in</h1>
        </div>

        {reset === '1' ? (
          /*
           * The one thing a completed reset gets: a line telling the person to
           * use the password they just set. Not a session — see the note in
           * `reset-password/[token]/actions.ts`.
           */
          <p
            role="status"
            className="border-jade-200 bg-jade-50 text-jade-900 mt-6 max-w-md rounded-lg border px-4 py-3 text-sm"
          >
            Your password is set. Sign in with it.
          </p>
        ) : null}

        <Card className="mt-6 max-w-md">
          <CardHeader>
            <CardTitle className="text-base">With your password</CardTitle>
          </CardHeader>
          <CardContent>
            <CredentialsForm next={target} />
          </CardContent>
        </Card>

        {demoMode ? (
          <>
            <h2 className="font-display mt-12 text-xl font-semibold">Or open a demo account</h2>
            <p className="text-sand-600 mt-2 max-w-prose text-sm leading-relaxed">
              These are synthetic accounts with no passwords, and this section exists only while
              the build is in demo mode. Pick one to see the product from that person’s point of
              view — role and tenant checks are enforced exactly as they would be in production.
            </p>
            <p className="text-sand-500 mt-2 max-w-prose text-sm leading-relaxed">
              Guests are not listed. A guest reaches the portal from the QR code at the front desk,
              and that link is their only credential — so it stays with the operator rather than
              being published here. The seed prints the demo links when it runs.
            </p>
            <p className="text-sand-500 mt-2 max-w-prose text-sm leading-relaxed">
              Not staying at a hotel?{' '}
              <Link
                href="/sign-up/direct"
                className="text-jade-800 underline underline-offset-4"
              >
                Plan a trip
              </Link>{' '}
              and book what you want to do. No room, no reference.
            </p>
            <p className="text-sand-500 mt-2 max-w-prose text-sm leading-relaxed">
              Run something guests would want to book?{' '}
              <Link
                href="/sign-up/partner"
                className="text-jade-800 underline underline-offset-4"
              >
                Ask a hotel to work with you
              </Link>
              . They decide, and their invitation is what creates your account.
            </p>
            <p className="text-sand-500 mt-2 max-w-prose text-sm leading-relaxed">
              Staying somewhere and want your bookings in one place?{' '}
              <Link
                href="/sign-up/guest"
                className="text-jade-800 underline underline-offset-4"
              >
                Create a guest account
              </Link>{' '}
              with your booking reference. That one needs a real password.
            </p>
          </>
        ) : (
          <div className="text-sand-600 mt-6 max-w-prose space-y-2 text-sm leading-relaxed">
            <p>
              Running a boutique hotel and want to try ARC Stay?{' '}
              <Link href="/sign-up" className="text-jade-800 underline underline-offset-4">
                Register your hotel
              </Link>
              .
            </p>
            <p>
              Not staying at a hotel but want to book things to do?{' '}
              <Link href="/sign-up/direct" className="text-jade-800 underline underline-offset-4">
                Plan a trip
              </Link>
              .
            </p>
            <p>
              Run surf lessons, a kitchen or a boat?{' '}
              <Link href="/sign-up/partner" className="text-jade-800 underline underline-offset-4">
                Ask a hotel to work with you
              </Link>
              .
            </p>
            <p>
              Staying at one?{' '}
              <Link
                href="/sign-up/guest"
                className="text-jade-800 underline underline-offset-4"
              >
                Create a guest account
              </Link>{' '}
              with the reference from your confirmation.
            </p>
          </div>
        )}

        <div className="mt-8 space-y-5">
          {groups.map((group) => {
            const members = accounts.filter((a) => a.roles.includes(group.role))
            if (members.length === 0) return null

            return (
              <Card key={group.role}>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">{group.label}</CardTitle>
                    <Badge tone="neutral">{group.role}</Badge>
                  </div>
                  <p className="text-sand-600 text-sm">{group.note}</p>
                </CardHeader>
                <CardContent className="space-y-2">
                  {members.slice(0, 10).map((account) => (
                    <form
                      key={account.id}
                      action={signInAction}
                      className="border-sand-200 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
                    >
                      <input type="hidden" name="email" value={account.email} />
                      <input type="hidden" name="next" value={defaultLanding(group.role, target)} />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{account.name}</p>
                        <p className="text-sand-500 truncate font-mono text-xs">{account.email}</p>
                      </div>
                      <Button type="submit" size="sm" variant="outline">
                        Sign in
                      </Button>
                    </form>
                  ))}

                </CardContent>
              </Card>
            )
          })}
        </div>
      </main>
    </div>
  )
}

function defaultLanding(role: string, requested: string): string {
  if (requested !== '/') return requested
  switch (role) {
    case 'OWNER':
    case 'STAFF':
      return '/owner'
    case 'SUPPLIER':
      return '/partner'
    case 'ADMIN':
      return '/admin'
    default:
      return '/'
  }
}
