import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarClock, Inbox, LayoutDashboard, Wallet } from 'lucide-react'
import { DemoBanner } from '@/components/demo-banner'
import { signOutAction } from '@/app/actions'
import { isAppError } from '@/lib/errors'
import { prisma } from '@/lib/db'
import { getActor } from '@/modules/auth/service'
import { resolveOperatingSupplier } from '@/modules/suppliers/service'

export const metadata = { title: { default: 'Partner', template: '%s · ARC Stay' } }

const NAV = [
  { href: '/partner', label: 'Overview', icon: LayoutDashboard },
  { href: '/partner/availability', label: 'Availability', icon: CalendarClock },
  { href: '/partner/bookings', label: 'Bookings', icon: Inbox },
  { href: '/partner/earnings', label: 'Earnings', icon: Wallet },
]

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor()
  if (!actor) redirect('/sign-in?next=/partner')

  let supplierName = 'Your business'
  try {
    const { supplierId } = await resolveOperatingSupplier(actor)
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { name: true },
    })
    supplierName = supplier?.name ?? supplierName
  } catch (error) {
    if (isAppError(error) && error.code === 'FORBIDDEN') redirect('/sign-in?next=/partner')
    throw error
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />

      <header className="border-sand-200 border-b bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-baseline gap-2">
            <Link href="/partner" className="font-display text-jade-900 font-semibold">
              ARC Stay
            </Link>
            <span className="text-sand-500">/</span>
            <span className="text-sand-700 text-sm">{supplierName}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sand-500 hidden text-xs sm:inline">{actor.name}</span>
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

        <nav aria-label="Partner sections" className="border-sand-200 overflow-x-auto border-t">
          <ul className="mx-auto flex max-w-5xl gap-1 px-4 py-1.5">
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

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">{children}</main>
    </div>
  )
}
