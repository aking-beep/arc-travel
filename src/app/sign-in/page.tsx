import { KeyRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DemoBanner } from '@/components/demo-banner'
import { signInAction } from '@/app/actions'
import { listDemoAccounts } from '@/modules/auth/service'

export const metadata = { title: 'Sign in' }

/**
 * Demo account switcher.
 *
 * The seeded accounts have no passwords, because inventing credentials for
 * synthetic people would only create something to leak. A real deployment
 * replaces this page and `signInByEmail` with a proper identity provider; every
 * authorisation decision behind it already re-derives from the database.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const target = next && next.startsWith('/') ? next : '/'
  const accounts = await listDemoAccounts()

  const groups = [
    { role: 'OWNER', label: 'Hotel owner', note: 'Full access to Casa Olas and its catalog.' },
    { role: 'STAFF', label: 'Front desk', note: 'Scoped to one property.' },
    { role: 'SUPPLIER', label: 'Local partners', note: 'Each sees only their own experiences.' },
    { role: 'ADMIN', label: 'Platform admin', note: 'Verification and system health.' },
    { role: 'GUEST', label: 'Guests', note: 'Normally reached by QR code, not by signing in.' },
  ] as const

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
        <div className="flex items-center gap-2">
          <KeyRound className="text-jade-700 size-5" aria-hidden />
          <h1 className="font-display text-2xl font-semibold">Choose a demo account</h1>
        </div>
        <p className="text-sand-600 mt-2 max-w-prose text-sm leading-relaxed">
          These are synthetic accounts with no passwords. Pick one to see the
          product from that person’s point of view — role and tenant checks are
          enforced exactly as they would be in production.
        </p>

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
                  {members.slice(0, group.role === 'GUEST' ? 6 : 10).map((account) => (
                    <form
                      key={account.id}
                      action={signInAction}
                      className="border-sand-200 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
                    >
                      <input type="hidden" name="email" value={account.email} />
                      <input
                        type="hidden"
                        name="next"
                        value={
                          group.role === 'GUEST' && account.portalToken
                            ? `/g/${account.portalToken}`
                            : defaultLanding(group.role, target)
                        }
                      />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{account.name}</p>
                        <p className="text-sand-500 truncate font-mono text-xs">{account.email}</p>
                      </div>
                      <Button type="submit" size="sm" variant="outline">
                        Sign in
                      </Button>
                    </form>
                  ))}
                  {group.role === 'GUEST' && members.length > 6 ? (
                    <p className="text-sand-500 text-xs">
                      {members.length - 6} more seeded guests not shown.
                    </p>
                  ) : null}
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
