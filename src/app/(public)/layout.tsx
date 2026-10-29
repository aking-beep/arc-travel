import type { Metadata } from 'next'
import { DemoBanner } from '@/components/demo-banner'
import { ExploreFooter } from '@/components/explore/footer'
import { ExploreMobileNav, ExploreNav, SavedToast } from '@/components/explore/nav'
import { SavedProvider } from '@/components/explore/saved-store'
import { getLocale } from '@/lib/i18n/server'
import { getActor } from '@/modules/auth/service'
import { countTripItems } from './trip-count'

export const metadata: Metadata = {
  title: {
    default: 'ARC Travel',
    template: '%s · ARC Travel',
  },
  description:
    'Boutique stays, local hosts and the cultural context to travel well. A demonstration build: every hotel, host, price and condition is synthetic.',
}

/**
 * The public destination surface — ARC Travel's front door.
 *
 * This is the application, carried over from the Magic Patterns export and
 * mounted at the root. The owner, partner, guest-portal and admin surfaces are
 * the operational product behind it and keep their own routes; `/demo` indexes
 * them, because the export has no equivalent of any of them and a demo that
 * cannot reach them is not a demo of this product. Three things about this
 * layout are deliberate.
 *
 * `data-surface="explore"` switches on the editorial palette defined in
 * `globals.css`. The four product surfaces are tools people use at work and
 * keep the sand/jade/terracotta ramps; this one is a public face and reads as
 * print. Scoping it to an attribute means neither restyles the other.
 *
 * `<DemoBanner>` sits above everything, as it does on every other surface.
 * This page shows prices, hosts and hotels that do not exist, so it is the
 * surface that needs the standing notice most.
 *
 * The whole tree is already behind the demo gate: `src/middleware.ts` matches
 * everything but `/gate` itself, so a hosted build asks for the passphrase
 * before any of this renders. Nothing here is indexed either — the root layout
 * sets `robots: { index: false }` and this metadata does not override it.
 */
export default async function ExploreLayout({ children }: { children: React.ReactNode }) {
  const [locale, actor, tripCount] = await Promise.all([
    getLocale(),
    getActor(),
    countTripItems(),
  ])

  return (
    <SavedProvider>
      <div data-surface="explore" className="flex min-h-dvh flex-col">
        <DemoBanner />
        <ExploreNav locale={locale} signedIn={actor !== null} tripCount={tripCount} />
        <main className="flex-1 pb-20 md:pb-0">{children}</main>
        <ExploreFooter />
        <ExploreMobileNav locale={locale} />
        <SavedToast />
      </div>
    </SavedProvider>
  )
}
