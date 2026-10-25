import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  CalendarCheck,
  ClipboardCheck,
  Hotel,
  LayoutDashboard,
  LineChart,
  Send,
  Store,
  Sunrise,
  Tags,
  Users,
} from 'lucide-react'
import { DemoBanner } from '@/components/demo-banner'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { signOutAction } from '@/app/actions'
import { getActor } from '@/modules/auth/service'
import { resolveOperatingProperty } from '@/modules/hotels/service'
import { prisma } from '@/lib/db'
import { getTranslator } from '@/lib/i18n/server'
import { isAppError } from '@/lib/errors'

export const metadata = { title: { default: 'Hotel', template: '%s · ARC Stay' } }

const NAV = [
  { href: '/owner', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/owner/briefing', label: 'Morning briefing', icon: Sunrise },
  { href: '/owner/catalog', label: 'Catalog', icon: Tags },
  { href: '/owner/partners', label: 'Partners', icon: Store },
  { href: '/owner/guests', label: 'Guests', icon: Users },
  { href: '/owner/arrivals', label: 'Arrivals', icon: CalendarCheck },
  { href: '/owner/approvals', label: 'Approvals', icon: ClipboardCheck },
  { href: '/owner/revenue', label: 'Revenue', icon: LineChart },
  { href: '/owner/payouts', label: 'Partner payouts', icon: Send },
  { href: '/owner/property', label: 'Property', icon: Hotel },
]

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor()
  if (!actor) redirect('/sign-in?next=/owner')

  let propertyName = 'Your property'
  try {
    const { propertyId } = await resolveOperatingProperty(actor)
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { name: true },
    })
    propertyName = property?.name ?? propertyName
  } catch (error) {
    if (isAppError(error) && error.code === 'FORBIDDEN') redirect('/sign-in?next=/owner')
    throw error
  }

  const { locale, t } = await getTranslator()

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />

      <header className="border-sand-200 bg-white/80 sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-baseline gap-2">
            <Link href="/owner" className="font-display text-jade-900 font-semibold tracking-tight">
              ARC Stay
            </Link>
            <span className="text-sand-400">/</span>
            <span className="text-sand-700 text-sm">{propertyName}</span>
          </div>
          <div className="flex items-center gap-3">
            <LocaleSwitcher locale={locale} next="/owner" />
            <span className="text-sand-500 hidden text-xs sm:inline">{actor.name}</span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="text-sand-600 hover:text-sand-900 text-xs underline underline-offset-4"
              >
                {t('common.signOut')}
              </button>
            </form>
          </div>
        </div>

        <nav
          aria-label="Hotel sections"
          className="border-sand-200 scrollbar-none overflow-x-auto border-t"
        >
          <ul className="mx-auto flex max-w-7xl gap-1 px-4 py-1.5">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-sand-700 hover:bg-sand-100 hover:text-sand-900 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors"
                >
                  <item.icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-8">{children}</main>
    </div>
  )
}
