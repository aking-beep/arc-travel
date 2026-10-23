'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BedDouble, Compass, Heart, Home, Menu, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { createTranslator, type AppLocale, type MessageKey } from '@/lib/i18n'
import { useSaved } from './saved-store'

interface NavItem {
  href: string
  key: MessageKey
}

const NAV_ITEMS: NavItem[] = [
  { href: '/explore/destinations', key: 'explore.nav.home' },
  { href: '/explore/stays', key: 'explore.nav.stay' },
  { href: '/explore/experiences', key: 'explore.nav.experiences' },
  { href: '/explore/plan', key: 'explore.nav.plan' },
  { href: '/explore/journal', key: 'explore.nav.guide' },
]

/**
 * The public surface's header.
 *
 * Transparent over a hero and solid once scrolled, as the export had it. The
 * scroll listener is the one piece of genuine interactivity, so this is a
 * client component; the pathname comes from `usePathname` rather than
 * `useLocation`, and the saved count from the store rather than a prop, so the
 * badge updates the moment something is saved.
 */
export function ExploreNav({ locale }: { locale: AppLocale }) {
  const t = createTranslator(locale)
  const pathname = usePathname()
  const { count, ready } = useSaved()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  const overHero = pathname === '/explore' || /^\/explore\/destinations\/[^/]+$/.test(pathname)
  const transparent = overHero && !scrolled && !open

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close the drawer on navigation, or it stays open over the new page.
  useEffect(() => setOpen(false), [pathname])

  return (
    <header
      className={cn(
        'inset-x-0 top-0 z-50 border-b transition-colors duration-200',
        overHero ? 'fixed' : 'sticky',
        transparent
          ? 'text-ivory border-transparent bg-transparent'
          : 'bg-ivory/95 text-ink border-line backdrop-blur',
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-5 md:h-20 md:px-8">
        <Link
          href="/explore"
          className="flex shrink-0 items-baseline gap-2"
          aria-label={t('explore.brand')}
        >
          <span className="text-2xl tracking-tight">ARC</span>
          <span
            className={cn(
              'text-[11px] tracking-[0.3em] uppercase',
              transparent ? 'text-ivory/80' : 'text-gold-deep',
            )}
          >
            Travel
          </span>
        </Link>

        <nav className="hidden items-center gap-8 lg:flex" aria-label={t('explore.brand')}>
          {NAV_ITEMS.map((item) => {
            const active = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'border-b py-1 text-sm whitespace-nowrap transition-colors duration-150',
                  active
                    ? transparent
                      ? 'border-ivory'
                      : 'border-gold text-ink'
                    : 'border-transparent hover:border-current',
                )}
              >
                {t(item.key)}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-2 md:gap-3">
          <Link
            href="/explore/trips"
            className={cn(
              'hidden items-center gap-2 rounded-full px-3 py-2 text-sm transition-colors duration-150 sm:flex',
              transparent ? 'hover:bg-ivory/10' : 'hover:bg-paper',
            )}
          >
            <Heart className="size-4" aria-hidden />
            <span className="whitespace-nowrap">{t('explore.nav.saved')}</span>
            {ready && count > 0 ? (
              <span className="bg-gold text-ink flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums">
                {count}
              </span>
            ) : null}
          </Link>
          <Link
            href="/explore/plan"
            className={cn(
              'hidden rounded-full px-4 py-2.5 text-sm whitespace-nowrap transition-colors duration-150 md:inline-flex',
              transparent ? 'bg-ivory text-ink hover:bg-paper' : 'bg-ink text-ivory hover:bg-ink-soft',
            )}
          >
            {t('explore.nav.plan')}
          </Link>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex size-11 items-center justify-center rounded-full lg:hidden"
            aria-label={open ? t('explore.nav.closeMenu') : t('explore.nav.menu')}
            aria-expanded={open}
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </div>

      {open ? (
        <nav className="bg-ivory text-ink border-line border-t px-5 pb-6 lg:hidden">
          {[{ href: '/explore', key: 'explore.nav.home' as MessageKey }, ...NAV_ITEMS, { href: '/explore/trips', key: 'explore.nav.saved' as MessageKey }].map(
            (item) => (
              <Link
                key={item.href}
                href={item.href}
                className="border-line block border-b py-4 text-2xl"
              >
                {t(item.key)}
              </Link>
            ),
          )}
        </nav>
      ) : null}
    </header>
  )
}

const BOTTOM_ITEMS = [
  { href: '/explore', key: 'explore.nav.home' as MessageKey, icon: Home, exact: true },
  { href: '/explore/destinations', key: 'explore.nav.guide' as MessageKey, icon: Compass },
  { href: '/explore/plan', key: 'explore.nav.plan' as MessageKey, icon: Sparkles },
  { href: '/explore/stays', key: 'explore.nav.stay' as MessageKey, icon: BedDouble },
  { href: '/explore/trips', key: 'explore.nav.saved' as MessageKey, icon: Heart },
]

/** Thumb-reachable bottom bar on phones. */
export function ExploreMobileNav({ locale }: { locale: AppLocale }) {
  const t = createTranslator(locale)
  const pathname = usePathname()

  return (
    <nav
      className="bg-ivory/95 border-line fixed inset-x-0 bottom-0 z-50 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      aria-label={t('explore.brand')}
    >
      <ul className="grid grid-cols-5">
        {BOTTOM_ITEMS.map(({ href, key, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href)
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 py-2.5 text-[11px]',
                  active ? 'text-ink' : 'text-muted',
                )}
              >
                <Icon
                  className={cn('size-5', active && 'text-gold-deep')}
                  strokeWidth={active ? 2 : 1.5}
                  aria-hidden
                />
                {t(key)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Confirmation for a save. `role="status"` so it is announced, not just seen. */
export function SavedToast() {
  const { toast } = useSaved()
  if (!toast) return null

  return (
    <div
      role="status"
      className="bg-ink text-ivory fixed bottom-24 left-1/2 z-60 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-3 text-sm shadow-lg md:bottom-8"
    >
      <Heart className="fill-gold text-gold size-4" aria-hidden />
      {toast}
    </div>
  )
}
