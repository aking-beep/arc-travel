import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Activity, Map, ShieldCheck } from 'lucide-react'
import { DemoBanner } from '@/components/demo-banner'
import { signOutAction } from '@/app/actions'
import { getActor } from '@/modules/auth/service'
import { isPlatformAdmin } from '@/modules/tenancy/context'

export const metadata = { title: { default: 'Admin', template: '%s · ARC Stay' } }

const NAV = [
  { href: '/admin', label: 'Verification', icon: ShieldCheck },
  { href: '/admin/destination', label: 'Destination graph', icon: Map },
  { href: '/admin/health', label: 'System health', icon: Activity },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor()
  if (!actor) redirect('/sign-in?next=/admin')

  // The same predicate `assertPlatformAdmin` uses. A tenant-scoped ADMIN
  // membership is not platform authority — admitting it here produced an error
  // page from the services behind this layout rather than a redirect.
  if (!isPlatformAdmin(actor)) redirect('/sign-in?next=/admin')

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />

      <header className="border-sand-200 border-b bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-baseline gap-2">
            <Link href="/admin" className="font-display text-jade-900 font-semibold">
              ARC Stay
            </Link>
            <span className="text-sand-500">/</span>
            <span className="text-sand-700 text-sm">Platform admin</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sand-500 hidden text-xs sm:inline">{actor.email}</span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="text-sand-600 hover:text-sand-900 text-xs underline underline-offset-4"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        <nav aria-label="Admin sections" className="border-sand-200 overflow-x-auto border-t">
          <ul className="mx-auto flex max-w-6xl gap-1 px-4 py-1.5">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-sand-700 hover:bg-sand-100 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm whitespace-nowrap"
                >
                  <item.icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">{children}</main>
    </div>
  )
}
