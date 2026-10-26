'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BedDouble, Compass, Heart, Home, Menu, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { setLocaleAction, signOutAction } from '@/app/actions'
import { createTranslator, type AppLocale, type MessageKey } from '@/lib/i18n'
import { useSaved } from './saved-store'

interface NavItem {
  href: string
  key: MessageKey
}

const NAV_ITEMS: NavItem[] = [
  { href: '/destinations', key: 'explore.nav.destinations' },
  { href: '/stays', key: 'explore.nav.stay' },
  { href: '/experiences', key: 'explore.nav.experiences' },
  { href: '/plan', key: 'explore.nav.plan' },
  { href: '/journal', key: 'explore.nav.guide' },
]

/**
 * Language toggle for the public surface.
 *
 * Two server-action forms rather than a client-side select, so it works with
 * JavaScript disabled — the same shape as `@/components/locale-switcher`, which
 * cannot be reused here because it is styled for the product surfaces and this
 * one has to invert over the transparent hero.
 *
 * This surface is fully translated and had no way to reach the Spanish copy
 * until this existed. A locale a reader cannot select is a locale that is not
 * really shipped.
 */
function LocaleToggle({
  locale,
  next,
  transparent,
  inDrawer = false,
}: {
  locale: AppLocale
  next: string
  transparent: boolean
  /** The drawer has the room the top bar does not, so it always shows. */
  inDrawer?: boolean
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-full border',
        inDrawer ? 'inline-flex' : 'hidden sm:flex',
        transparent ? 'border-ivory/40' : 'border-line',
      )}
    >
      {(['en', 'es'] as const).map((code) => (
        <form key={code} action={setLocaleAction}>
          <input type="hidden" name="locale" value={code} />
          <input type="hidden" name="next" value={next} />
          <button
            type="submit"
            aria-current={locale === code ? 'true' : undefined}
            className={cn(
              'px-2.5 py-1.5 text-[11px] uppercase transition-colors duration-150',
              locale === code
                ? transparent
                  ? 'bg-ivory/20'
                  : 'bg-ink text-ivory'
                : // Not `opacity-60`: opacity multiplies against whatever is
                  // behind it, so the resulting contrast is not something
                  // anyone can state, and here it came out below 4.5:1. An
                  // explicit colour is checkable. ADR-038.
                  transparent
                  ? 'text-ivory/80 hover:text-ivory'
                  : 'text-muted hover:text-ink',
            )}
          >
            {code}
          </button>
        </form>
      ))}
    </div>
  )
}

/**
 * The public surface's header.
 *
 * Transparent over a hero and solid once scrolled, as the export had it. The
 * scroll listener is the one piece of genuine interactivity, so this is a
 * client component; the pathname comes from `usePathname` rather than
 * `useLocation`, and the saved count from the store rather than a prop, so the
 * badge updates the moment something is saved.
 */
export function ExploreNav({
  locale,
  signedIn,
}: {
  locale: AppLocale
  /**
   * Resolved in the layout, not here: this is a client component and the
   * session cookie is HttpOnly, so whether anyone is signed in is something
   * only the server can answer. Passed as a prop rather than read during
   * render.
   */
  signedIn: boolean
}) {
  const t = createTranslator(locale)
  const pathname = usePathname()
  const { count, ready } = useSaved()
  const [scrolled, setScrolled] = useState(false)
  // The drawer remembers which path it was opened on rather than carrying a
  // boolean an effect has to clear: a navigation changes `pathname`, so the
  // drawer closes by itself and no state is written during an effect.
  const [openPath, setOpenPath] = useState<string | null>(null)
  const open = openPath === pathname

  const overHero = pathname === '/' || /^\/destinations\/[^/]+$/.test(pathname)
  const transparent = overHero && !scrolled && !open

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

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
          href="/"
          className="flex shrink-0 items-baseline gap-2"
          /*
           * No `aria-label`. It read "ARC Travel — destination commerce" or its
           * Spanish equivalent, which does not contain the link's visible text
           * in the order it appears, so a voice-control user saying "click ARC
           * Travel" could not activate it (WCAG 2.5.3, and axe's
           * `label-content-name-mismatch`). The two spans already read "ARC
           * Travel"; naming it again, differently, only broke it.
           */
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
          <LocaleToggle locale={locale} next={pathname} transparent={transparent} />
          <Link
            href="/trips"
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
            href="/plan"
            className={cn(
              'hidden rounded-full px-4 py-2.5 text-sm whitespace-nowrap transition-colors duration-150 md:inline-flex',
              transparent ? 'bg-ivory text-ink hover:bg-paper' : 'bg-ink text-ivory hover:bg-ink-soft',
            )}
          >
            {t('explore.nav.plan')}
          </Link>
          <button
            type="button"
            onClick={() => setOpenPath(open ? null : pathname)}
            className="flex size-11 items-center justify-center rounded-full"
            aria-label={open ? t('explore.nav.closeMenu') : t('explore.nav.menu')}
            aria-expanded={open}
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </div>

      {open ? (
        <nav className="bg-ivory text-ink border-line border-t px-5 pb-6">
          <div className="lg:hidden">
            {[
              { href: '/', key: 'explore.nav.home' as MessageKey },
              ...NAV_ITEMS,
              { href: '/trips', key: 'explore.nav.saved' as MessageKey },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="border-line block border-b py-4 text-2xl"
              >
                {t(item.key)}
              </Link>
            ))}
          </div>

          {/*
           * Account. The public surface had no way in or out of a session at
           * all: `/me` and `/sign-in` existed and nothing linked to them.
           *
           * Signed out, the link carries the current path so sign-in returns
           * the reader to where they were. Signed in, sign-out is a form
           * posting to the server action, not a link — it mutates a session,
           * and a GET that signs somebody out can be fired by anything that
           * can make the browser follow a URL.
           */}
          <div className="pt-6">
            {signedIn ? (
              <>
                <Link
                  href="/me"
                  className="border-line block border-b py-4 text-2xl"
                >
                  {t('account.title')}
                </Link>
                <form action={signOutAction}>
                  <button type="submit" className="border-line block w-full border-b py-4 text-left text-2xl">
                    {t('common.signOut')}
                  </button>
                </form>
              </>
            ) : (
              <Link
                href={`/sign-in?next=${encodeURIComponent(pathname)}`}
                className="border-line block border-b py-4 text-2xl"
              >
                {t('common.signIn')}
              </Link>
            )}
          </div>

          <div className="pt-6">
            <LocaleToggle locale={locale} next={pathname} transparent={false} inDrawer />
          </div>
        </nav>
      ) : null}
    </header>
  )
}

const BOTTOM_ITEMS = [
  { href: '/', key: 'explore.nav.home' as MessageKey, icon: Home, exact: true },
  { href: '/destinations', key: 'explore.nav.destinations' as MessageKey, icon: Compass },
  { href: '/plan', key: 'explore.nav.plan' as MessageKey, icon: Sparkles },
  { href: '/stays', key: 'explore.nav.stay' as MessageKey, icon: BedDouble },
  { href: '/trips', key: 'explore.nav.saved' as MessageKey, icon: Heart },
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
