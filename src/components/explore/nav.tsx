'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { BedDouble, Compass, Heart, Home, Menu, ShoppingBag, Sparkles, User, X } from 'lucide-react'
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
  tripCount,
}: {
  locale: AppLocale
  /**
   * Resolved in the layout, not here: this is a client component and the
   * session cookie is HttpOnly, so whether anyone is signed in is something
   * only the server can answer. Passed as a prop rather than read during
   * render.
   */
  signedIn: boolean
  /**
   * How many departures are in the storefront basket, resolved in the layout
   * for the same reason `signedIn` is: the trip cookie is HttpOnly and only
   * the server can read it.
   */
  tripCount: number
}) {
  const t = createTranslator(locale)
  const pathname = usePathname()
  const search = useSearchParams().toString()
  const { count, ready } = useSaved()
  /*
   * Where to come back to. `usePathname` drops the query string, and the
   * views most worth returning to are the ones that have one —
   * `/stays?destination=`, `/search?q=`. Both the locale forms and the
   * sign-in link post it as `next`, and both are read back through
   * `safeNext`, which keeps the params and refuses an absolute URL.
   */
  const here = search ? `${pathname}?${search}` : pathname
  const [scrolled, setScrolled] = useState(false)
  // The drawer remembers which path it was opened on rather than carrying a
  // boolean an effect has to clear: a navigation changes `pathname`, so the
  // drawer closes by itself and no state is written during an effect.
  const [openPath, setOpenPath] = useState<string | null>(null)
  const open = openPath === pathname

  const overHero = pathname === '/' || /^\/destinations\/[^/]+$/.test(pathname)
  const transparent = overHero && !scrolled && !open

  /*
   * Scroll, and keeping a `fixed` header out from under the demo banner.
   *
   * On the hero pages this header is fixed to the viewport so the photograph
   * runs behind it, and `DemoBanner` is a sibling in normal flow above it — so
   * at `top-0` the header was drawn over the banner. While unscrolled the
   * header is transparent with `text-ivory` controls, which is legible over a
   * dark photograph and invisible over the banner's cream. It passed the
   * accessibility spec only because the banner was one line tall and most of
   * each control's box still had the hero behind it; lengthening that sentence
   * wrapped it to two lines and put nine controls at a contrast ratio of 1.04.
   * ADR-038's point exactly — that was a contrast decision, not a copy one.
   *
   * So the header's `top` is however much of the banner is still on screen.
   * Measured rather than hard-coded, because the height is whatever the text
   * wraps to, which differs between English and Spanish and between
   * viewports; observed, so a resize keeps it true; and written straight to
   * the node rather than through state, because this runs on every scroll
   * event. Zero outside demo mode, where there is no banner.
   */
  const header = useRef<HTMLElement>(null)
  useEffect(() => {
    const banner = overHero ? document.querySelector('[data-demo-banner]') : null
    let bannerHeight = banner?.getBoundingClientRect().height ?? 0

    /*
     * Cleared, not merely left unset, when this is not a hero page.
     *
     * This component lives in the layout, so the node survives a client
     * navigation. An inline `top` written on `/` outlives the trip to
     * `/experiences` and overrides `sticky top-0` there — the bar then sticks
     * a banner's height below the top of the viewport. Both the else branch
     * and the cleanup remove the property rather than setting it to `0px`, so
     * the class is what decides.
     */
    const place = () => {
      setScrolled(window.scrollY > 40)
      if (!header.current) return
      if (overHero) {
        const top = Math.max(0, bannerHeight - window.scrollY)
        header.current.style.top = `${String(top)}px`
      } else {
        header.current.style.removeProperty('top')
      }
    }
    place()

    window.addEventListener('scroll', place, { passive: true })
    const observer = banner
      ? new ResizeObserver(() => {
          bannerHeight = banner.getBoundingClientRect().height
          place()
        })
      : null
    if (banner) observer?.observe(banner)

    return () => {
      window.removeEventListener('scroll', place)
      observer?.disconnect()
      header.current?.style.removeProperty('top')
    }
  }, [overHero])

  return (
    <header
      ref={header}
      className={cn(
        'inset-x-0 z-50 border-b transition-colors duration-200',
        overHero ? 'fixed' : 'sticky top-0',
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
          <LocaleToggle locale={locale} next={here} transparent={transparent} />
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
          {tripCount > 0 ? (
            <Link
              href="/book"
              className={cn(
                'flex items-center gap-2 rounded-full px-3 py-2 text-sm transition-colors duration-150',
                transparent ? 'hover:bg-ivory/10' : 'hover:bg-paper',
              )}
            >
              <ShoppingBag className="size-4" aria-hidden />
              <span className="hidden whitespace-nowrap sm:inline">
                {t('explore.book.heading')}
              </span>
              <span className="bg-gold text-ink flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums">
                {tripCount}
              </span>
            </Link>
          ) : null}
          {signedIn ? (
            <Link
              href="/me"
              className={cn(
                'hidden items-center gap-2 rounded-full px-3 py-2 text-sm transition-colors duration-150 sm:flex',
                transparent ? 'hover:bg-ivory/10' : 'hover:bg-paper',
              )}
            >
              <User className="size-4" aria-hidden />
              <span className="whitespace-nowrap">{t('account.title')}</span>
            </Link>
          ) : (
            <Link
              href={`/sign-in?next=${encodeURIComponent(here)}`}
              className={cn(
                'hidden items-center gap-2 rounded-full px-3 py-2 text-sm transition-colors duration-150 sm:flex',
                transparent ? 'hover:bg-ivory/10' : 'hover:bg-paper',
              )}
            >
              <User className="size-4" aria-hidden />
              <span className="whitespace-nowrap">{t('common.signIn')}</span>
            </Link>
          )}
          {/*
           * The loudest control on the page, and it used to repeat the nav
           * item two inches to its left — same words, same destination, the
           * illustrative planner that cannot sell anything. Two buttons
           * reading "Trip planning" pointing at one page is how a visitor
           * concludes there is only one planner; there are three, and this is
           * the one that books nothing.
           *
           * It keeps its destination — drafting a trip is a reasonable front
           * door, and the planner now carries a real exit to the property
           * that can be booked — but it says what it is, and it no longer
           * duplicates its neighbour.
           */}
          <Link
            href="/plan"
            className={cn(
              'hidden rounded-full px-4 py-2.5 text-sm whitespace-nowrap transition-colors duration-150 md:inline-flex',
              transparent ? 'bg-ivory text-ink hover:bg-paper' : 'bg-ink text-ivory hover:bg-ink-soft',
            )}
          >
            {t('explore.nav.draftTrip')}
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
                href={`/sign-in?next=${encodeURIComponent(here)}`}
                className="border-line block border-b py-4 text-2xl"
              >
                {t('common.signIn')}
              </Link>
            )}
          </div>

          <div className="pt-6">
            <LocaleToggle locale={locale} next={here} transparent={false} inDrawer />
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
