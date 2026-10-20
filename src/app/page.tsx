import Link from 'next/link'
import { ArrowRight, BrainCircuit, Compass, Hotel, ShieldCheck, Store } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/button'
import { DemoBanner } from '@/components/demo-banner'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { getTranslator } from '@/lib/i18n/server'
import { prisma } from '@/lib/db'

/**
 * Entry page. Not a marketing site — it is the door into the four surfaces, so
 * that a demo can start from any of them without hunting for a URL.
 */
export default async function HomePage() {
  const { locale, t } = await getTranslator()

  const property = await prisma.property.findFirst({
    where: { slug: 'casa-olas' },
    select: { id: true, name: true, tagline: true, roomCount: true },
  })

  const demoStay = await prisma.stay.findFirst({
    where: { portalToken: { startsWith: 'demo-portal-' } },
    orderBy: { portalToken: 'asc' },
    select: { portalToken: true, guest: { select: { firstName: true } } },
  })

  const surfaces = [
    {
      href: '/owner',
      icon: Hotel,
      title: 'Hotel owner',
      body: 'Onboarding, experience storefront, partner invitations, arrivals, a morning briefing built from stored facts, and revenue separated from opportunity.',
    },
    {
      href: demoStay ? `/g/${demoStay.portalToken}` : '/sign-in',
      icon: Compass,
      title: 'Traveller',
      body: 'The guest portal as it arrives from a QR code: preference intake, a day-by-day itinerary with its reasoning shown, the local guide, and a simulated checkout.',
    },
    {
      href: '/partner',
      icon: Store,
      title: 'Local partner',
      body: 'Supplier profile, experiences, availability slots, capacity, pricing, incoming booking requests and earnings.',
    },
    {
      href: '/admin',
      icon: BrainCircuit,
      title: 'Platform admin',
      body: 'Property and partner verification, the destination graph with its provenance, data quality controls and system health.',
    },
  ]

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />

      <header className="border-sand-200 border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-jade-900 text-lg font-semibold tracking-tight">
              ARC Stay
            </span>
            <span className="text-sand-500 text-xs">by ARC Travel</span>
          </div>
          <div className="flex items-center gap-3">
            <LocaleSwitcher locale={locale} next="/" />
            <LinkButton href="/sign-in" variant="outline" size="sm" className="hidden sm:inline-flex">
              {t('common.signIn')}
            </LinkButton>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:py-16">
        <div className="max-w-2xl">
          <Badge tone="brand">Proof of concept · Puerto Escondido, Oaxaca</Badge>
          <h1 className="font-display mt-5 text-4xl leading-[1.05] font-semibold tracking-tight sm:text-5xl">
            Destination commerce for independent boutique hotels.
          </h1>
          <p className="text-sand-700 mt-5 text-lg leading-relaxed">
            A hotel already holds the knowledge a guest wants: which cove is
            calm enough for a first surf lesson, which panga captain shows up on
            time, where to eat on a Tuesday. ARC Stay turns that into a
            structured, verifiable catalog a guest can actually book — and pays
            the hotel for it.
          </p>

          {property ? (
            <p className="text-sand-600 mt-4 text-sm">
              This environment runs on <strong className="text-sand-900">{property.name}</strong>,
              a fictional {property.roomCount}-room property in La Rinconada, with synthetic
              guests, partners and conditions.
            </p>
          ) : (
            <p className="mt-4 text-sm text-red-800">
              No seeded property found. Run <code className="font-mono">npm run db:seed</code>.
            </p>
          )}
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {surfaces.map((surface) => (
            <Link
              key={surface.href}
              href={surface.href}
              className="card-surface hover:border-jade-300 group flex flex-col gap-3 p-6 transition-colors"
            >
              <surface.icon className="text-jade-700 size-6" aria-hidden />
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">{surface.title}</h2>
                <ArrowRight className="text-sand-400 group-hover:text-jade-700 size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </div>
              <p className="text-sand-600 text-sm leading-relaxed">{surface.body}</p>
            </Link>
          ))}
        </div>

        <section className="border-sand-200 mt-14 border-t pt-8">
          <div className="flex items-start gap-3">
            <ShieldCheck className="text-jade-700 mt-0.5 size-5 shrink-0" aria-hidden />
            <div className="max-w-3xl">
              <h2 className="font-semibold">What this build will not do</h2>
              <ul className="text-sand-600 mt-2 space-y-1.5 text-sm leading-relaxed">
                <li>
                  It does not invent availability, verify a supplier, or claim a
                  commercial relationship that does not exist. Every fixture
                  partner is marked unverified.
                </li>
                <li>
                  It does not tell you a beach is safe. Ocean readings are shown
                  with their timestamp and source, and conditions gate what can
                  be recommended at all.
                </li>
                <li>
                  It does not take money or message guests. Checkout is
                  simulated, and no action is taken on a hotel’s behalf without
                  a recorded approval.
                </li>
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-sand-200 border-t">
        <div className="text-sand-500 mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-6 text-xs">
          <p>ARC Stay · a product of ARC Travel, ARC Transformation Group.</p>
          <p>{t('common.demoData')}</p>
        </div>
      </footer>
    </div>
  )
}
