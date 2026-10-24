import Link from 'next/link'
import { notFound as nextNotFound } from 'next/navigation'
import { Compass, Map, ShoppingBasket, Sparkles } from 'lucide-react'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { isAppError } from '@/lib/errors'
import { getLocale } from '@/lib/i18n/server'
import { createTranslator } from '@/lib/i18n'
import { getEnv } from '@/lib/env'
import { prisma } from '@/lib/db'
import { resolvePortalForRequest } from './resolve'

/**
 * Guest portal shell.
 *
 * Mobile-first by construction: a bottom tab bar inside the thumb zone, a
 * single-column body, safe-area padding for the home bar, and the hotel's own
 * colours applied as CSS variables so the portal reads as the property's rather
 * than as ARC's.
 */
export default async function GuestLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  let context
  try {
    context = await resolvePortalForRequest(token)
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') nextNotFound()
    throw error
  }

  const locale = await getLocale()
  const t = createTranslator(locale)
  const demoMode = getEnv().ARC_DATA_MODE === 'demo'

  const basketCount = await prisma.cartItem.count({
    where: { cart: { guestId: context.guestId, status: 'OPEN' } },
  })

  const base = `/g/${token}`
  const tabs = [
    { href: base, label: t('guest.itinerary'), icon: Sparkles },
    { href: `${base}/explore`, label: t('guest.explore'), icon: Compass },
    { href: `${base}/guide`, label: t('guest.guide'), icon: Map },
    { href: `${base}/basket`, label: t('guest.cart'), icon: ShoppingBasket, count: basketCount },
  ]

  return (
    <div
      className="flex min-h-dvh flex-col"
      style={
        {
          '--brand': context.property.brandPrimary,
          '--accent': context.property.brandAccent,
        } as React.CSSProperties
      }
    >
      {demoMode ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[0.6875rem] leading-snug text-amber-900">
          {t('common.demoBanner')}
        </div>
      ) : null}

      <header
        className="pt-safe px-5 pb-4 text-white"
        style={{ backgroundColor: 'var(--brand)' }}
      >
        <div className="mx-auto flex max-w-2xl items-start justify-between gap-3 pt-3">
          <div className="min-w-0">
            <p className="text-xs tracking-wide uppercase opacity-70">{t('guest.welcome')}</p>
            <h1 className="font-display truncate text-xl font-semibold">{context.property.name}</h1>
            {context.property.placeName ? (
              <p className="text-xs opacity-75">{context.property.placeName}</p>
            ) : null}
          </div>
          <LocaleSwitcher locale={locale} next={base} className="shrink-0 border-white/30" />
        </div>
        <p className="mx-auto mt-3 max-w-2xl text-sm opacity-90">
          {context.guestFirstName} · {context.checkIn} → {context.checkOut}
        </p>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-6 pb-28">{children}</main>

      <nav
        aria-label="Guest sections"
        className="border-sand-200 pb-safe fixed inset-x-0 bottom-0 z-30 border-t bg-white/95 backdrop-blur"
      >
        <ul className="mx-auto flex max-w-2xl items-stretch">
          {tabs.map((tab) => (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                className="text-sand-600 hover:text-jade-800 flex flex-col items-center gap-0.5 px-2 py-2.5 text-[0.6875rem] font-medium"
              >
                <span className="relative">
                  <tab.icon className="size-5" aria-hidden />
                  {tab.count ? (
                    <span
                      className="absolute -top-1.5 -right-2 flex size-4 items-center justify-center rounded-full text-[0.625rem] font-semibold text-white"
                      style={{ backgroundColor: 'var(--accent)' }}
                    >
                      {tab.count}
                    </span>
                  ) : null}
                </span>
                {tab.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
