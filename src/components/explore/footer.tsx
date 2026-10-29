import Link from 'next/link'
import { getTranslator } from '@/lib/i18n/server'
import { destinations } from '@/modules/discovery/content/destinations'

/**
 * The public surface's footer.
 *
 * A Server Component, unlike the export's, because the newsletter form it was
 * built around is gone. That form validated an address, showed "Subscribed to
 * the ARC Journal (prototype — no email sent)" and did nothing: a dead input
 * asking for an email address is worse than no input, and collecting one with
 * no consent record would be its own problem. What is left is navigation and
 * the standing disclaimer, neither of which needs the client.
 */
export async function ExploreFooter() {
  const { t, locale } = await getTranslator()
  void locale

  return (
    <footer className="bg-ink text-ivory/80">
      <div className="mx-auto max-w-7xl px-5 pt-16 pb-28 md:px-8 md:pb-12">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <p className="text-ivory text-3xl">{t('explore.brand')}</p>
            <p className="text-gold mt-2 italic">{t('explore.tagline')}</p>
            <p className="text-ivory/60 mt-6 max-w-sm text-sm leading-relaxed">
              {t('explore.hero.demoNote')}
            </p>
          </div>

          <FooterColumn
            title={t('explore.footer.exploreHeading')}
            links={[
              ['/destinations', t('explore.nav.destinations')],
              ['/stays', t('explore.nav.stay')],
              ['/experiences', t('explore.nav.experiences')],
              ['/journal', t('explore.nav.guide')],
            ]}
          />
          <FooterColumn
            title={t('explore.nav.plan')}
            links={[
              ['/plan', t('explore.nav.plan')],
              ['/trips', t('explore.nav.saved')],
              ['/culture/puerto-escondido', t('explore.guide.heading')],
              ['/search', t('explore.experiences.search')],
              // The route in for somebody who is not staying anywhere
              // (ADR-042): the planner, with no room booked.
              ['/sign-up/direct', t('explore.footer.bookDirect')],
            ]}
          />
          <FooterColumn
            title={t('explore.footer.aboutHeading')}
            links={[
              ['/demo', t('explore.footer.demoSurfaces')],
              // The page a guest looks for when something has gone wrong. It
              // did not exist; every route a person would guess 404'd.
              ['/support', t('explore.footer.help')],
              ['/terms', t('explore.footer.terms')],
              ['/privacy', t('explore.footer.privacy')],
              ...destinations
                .slice(0, 2)
                .map((d) => [`/destinations/${d.slug}`, d.name] as [string, string]),
            ]}
          />
        </div>

        <div className="border-ivory/15 text-ivory/50 mt-16 flex flex-col justify-between gap-3 border-t pt-6 text-xs md:flex-row">
          <p>{t('explore.footer.disclaimer', { year: '2026' })}</p>
          <p>{t('explore.plan.step3Heading')}</p>
        </div>
      </div>
    </footer>
  )
}

function FooterColumn({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-ivory mb-4 text-sm font-medium">{title}</p>
      <ul className="space-y-3 text-sm">
        {links.map(([href, label]) => (
          <li key={href}>
            <Link href={href} className="hover:text-gold transition-colors duration-150">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
