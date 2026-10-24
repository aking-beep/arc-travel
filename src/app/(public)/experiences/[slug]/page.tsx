import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Check, Clock, Gauge, Info, MapPin, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { ListingBadge, Shell } from '@/components/explore/editorial'
import { ExperienceCard } from '@/components/explore/cards'
import { PartyEstimator } from '@/components/explore/party-estimator'
import { SaveButton } from '@/components/explore/save-button'
import { getTranslator } from '@/lib/i18n/server'
import { getDestination } from '@/modules/discovery/content/destinations'
import { experiences, getExperience } from '@/modules/discovery/content/experiences'
import { liveExperience } from '@/modules/discovery/live'
import { CONTENT_CURRENCY } from '@/modules/discovery/content/types'

export async function generateStaticParams() {
  return experiences.map((experience) => ({ slug: experience.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { locale } = await getTranslator()
  const experience = (await liveExperience(slug, locale)) ?? getExperience(slug)
  return { title: experience?.title ?? 'Experience' }
}

/**
 * One experience, ported from the export's `ExperienceDetailPage`.
 *
 * Two sections changed shape rather than style.
 *
 * The export's **Safety** panel rendered each string behind a green
 * `ShieldCheck`, which reads as ARC vouching for the operator's practice. ARC
 * is in no position to: none of these hosts has been verified, and
 * `CLAUDE.md` is explicit that a claim renders as a claim. It is now "What the
 * host tells us", with an `Info` glyph and a line saying nobody has checked it.
 *
 * The export's **Request to book** opened an enquiry modal. There is no booking
 * path on this surface — see `PartyEstimator` for why — so the panel estimates
 * and then points at the guest portal.
 */
export default async function ExperienceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { t, locale } = await getTranslator()

  /*
   * The published catalogue first, the content set second.
   *
   * A slug belongs to one or the other and the database is the authority where
   * both could answer: a real supplier's listing must not be shadowed by a
   * fixture that happens to share a slug. `liveExperience` returns null rather
   * than throwing for an unknown or unpublished slug, which is what makes a
   * fall-through rather than a 500.
   */
  const experience = (await liveExperience(slug, locale)) ?? getExperience(slug)
  if (!experience) notFound()
  const destination = getDestination(experience.destination)

  const related = experiences
    .filter(
      (x) =>
        x.slug !== experience.slug &&
        (x.destination === experience.destination || x.activity === experience.activity),
    )
    .slice(0, 3)

  const initials = experience.host.name
    .split(' ')
    .map((word) => word[0])
    .slice(0, 2)
    .join('')

  return (
    <div>
      <Shell className="pt-6 md:pt-10">
        <p className="text-muted mb-4 text-sm">
          <Link href="/experiences" className="hover:text-ink">
            {t('explore.experience.back')}
          </Link>
          {destination ? (
            <>
              {' / '}
              <Link
                href={`/destinations/${destination.slug}`}
                className="hover:text-ink"
              >
                {destination.name}
              </Link>
            </>
          ) : null}
        </p>
        <div className="bg-sand relative aspect-4/3 overflow-hidden rounded-3xl md:aspect-21/9">
          {experience.image ? (
            <Image
              src={experience.image}
              alt={experience.title}
              fill
              priority
              sizes="100vw"
              className="object-cover"
            />
          ) : null}
          <div className="absolute top-4 left-4">
            <ListingBadge
              status={experience.verification}
              provenance={experience.provenance}
              locale={locale}
              onImage
            />
          </div>
          <div className="absolute top-4 right-4">
            <SaveButton
              kind="experiences"
              slug={experience.slug}
              label={experience.title}
              locale={locale}
            />
          </div>
        </div>
      </Shell>

      <Shell className="mt-10 grid gap-12 pb-20 lg:grid-cols-[1fr_360px] lg:gap-16">
        <div>
          <p className="text-gold-deep text-sm">
            {experience.category} · {experience.activity}
            {destination ? ` · ${destination.name}` : ''}
          </p>
          <h1 className="mt-2 text-4xl leading-[1.05] tracking-tight md:text-6xl">
            {experience.title}
          </h1>

          <dl className="border-line mt-8 grid grid-cols-2 gap-6 border-y py-6 md:grid-cols-4">
            <Stat
              icon={<Clock className="size-4" aria-hidden />}
              label={t('explore.experience.duration')}
              value={experience.duration}
            />
            <Stat
              icon={<Gauge className="size-4" aria-hidden />}
              label={t('explore.experience.ability')}
              value={experience.difficulty}
            />
            <Stat
              icon={<Users className="size-4" aria-hidden />}
              label={t('explore.experience.party')}
              value={experience.groupSize}
            />
            <Stat
              icon={<MapPin className="size-4" aria-hidden />}
              label="Where"
              value={destination?.name ?? '—'}
            />
          </dl>

          <section className="mt-10">
            <p className="text-2xl leading-snug">{experience.summary}</p>
            {experience.description.map((paragraph) => (
              <p key={paragraph} className="text-muted mt-4 leading-relaxed">
                {paragraph}
              </p>
            ))}
          </section>

          {/*
            * Only when there is one. The database holds no step-by-step
            * breakdown, so a live listing shows an empty heading rather than
            * an invented schedule — which is to say, it shows nothing.
            */}
          <section className={experience.itinerary.length > 0 ? 'mt-14' : 'hidden'}>
            <h2 className="mb-6 text-2xl md:text-3xl">How the day unfolds</h2>
            <ol className="border-line relative ml-2 border-l">
              {experience.itinerary.map((step) => (
                <li key={step.time} className="relative pb-7 pl-8 last:pb-0">
                  <span className="bg-gold absolute top-1.5 -left-[5px] size-[9px] rounded-full" />
                  <p className="text-muted text-xs tabular-nums">{step.time}</p>
                  <p className="mt-1">{step.step}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="bg-paper mt-14 grid gap-6 rounded-3xl p-6 md:grid-cols-[120px_1fr] md:p-8">
            <div
              className="bg-sage text-ivory flex size-20 items-center justify-center rounded-full text-3xl md:size-28"
              aria-hidden
            >
              {initials}
            </div>
            <div>
              <p className="text-muted text-xs">{t('explore.experience.hostedBy')}</p>
              <p className="mt-1 text-2xl">{experience.host.name}</p>
              {experience.host.role ? (
                <p className="text-sage text-sm">
                  {experience.host.role}
                  {experience.host.years !== undefined ? ` · ${experience.host.years} years` : ''}
                </p>
              ) : null}
              {experience.host.bio ? (
                <p className="text-muted mt-3 text-sm leading-relaxed">{experience.host.bio}</p>
              ) : null}
            </div>
          </section>

          <section className="mt-14 grid gap-10 md:grid-cols-2">
            <div>
              <h2 className="mb-4 text-2xl">{t('explore.experience.meetingPoint')}</h2>
              <p className="flex gap-2 text-sm leading-relaxed">
                <MapPin className="text-gold-deep mt-0.5 size-4 shrink-0" aria-hidden />
                {experience.meetingPoint}
              </p>
              <h3 className="mt-8 mb-3 text-xl">What&rsquo;s included</h3>
              <ul className="space-y-2">
                {experience.included.map((item) => (
                  <li key={item} className="flex gap-2 text-sm">
                    <Check className="text-sage mt-0.5 size-4 shrink-0" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="mb-2 text-2xl">{t('explore.experience.claimsHeading')}</h2>
              <p className="text-muted mb-4 text-xs leading-relaxed">
                {t('explore.experience.claimsNote')}
              </p>
              <ul className="space-y-3">
                {experience.hostClaims.length === 0 ? (
                  <li className="text-muted text-sm">
                    {t('explore.experience.noClaims')}
                  </li>
                ) : null}
                {experience.hostClaims.map((claim) => (
                  <li key={claim} className="flex gap-2 text-sm leading-relaxed">
                    <Info className="text-muted mt-0.5 size-4 shrink-0" aria-hidden />
                    {claim}
                  </li>
                ))}
              </ul>
              {destination ? (
                <Link
                  href={`/culture/${destination.slug}`}
                  className="border-gold mt-6 inline-block border-b pb-0.5 text-sm"
                >
                  {t('explore.guide.heading')} — {destination.name}
                </Link>
              ) : null}
            </div>
          </section>
        </div>

        <aside className="order-first self-start lg:sticky lg:top-28 lg:order-none">
          <PartyEstimator
            locale={locale}
            amountMinor={experience.priceMinor}
            currency={experience.currency ?? CONTENT_CURRENCY}
            minParty={1}
            maxParty={10}
            defaultParty={2}
            portalHref="/sign-in"
          />
          <Link
            href={`/plan?destination=${experience.destination}`}
            className="border-line hover:border-ink mt-3 flex h-12 w-full items-center justify-center rounded-full border text-sm transition-colors duration-150"
          >
            Add to a trip plan
          </Link>
        </aside>
      </Shell>

      {related.length > 0 ? (
        <section className="bg-paper">
          <Shell className="py-16">
            <h2 className="mb-8 text-3xl">You might also like</h2>
            <div className="grid gap-6 sm:grid-cols-3">
              {related.map((item) => (
                <ExperienceCard key={item.slug} experience={item} locale={locale} />
              ))}
            </div>
          </Shell>
        </section>
      ) : null}
    </div>
  )
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted flex items-center gap-1.5 text-xs">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  )
}
