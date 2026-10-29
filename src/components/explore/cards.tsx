import Image from 'next/image'
import Link from 'next/link'
import {
  Clock,
  Compass,
  Gauge,
  Landmark,
  Leaf,
  Mountain,
  Car,
  UtensilsCrossed,
} from 'lucide-react'
import { Money } from '@/components/money'
import { cn } from '@/lib/cn'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import { getDestination } from '@/modules/discovery/content/destinations'
import { CONTENT_CURRENCY } from '@/modules/discovery/content/types'
import type {
  Destination,
  Experience,
  ExperienceCategory,
  Property,
} from '@/modules/discovery/content/types'
import { ListingBadge } from './editorial'
import { SaveButton } from './save-button'

/**
 * Listing cards for the public surface.
 *
 * Three changes from the export. Every figure goes through `<Money>`, so it
 * carries the demo marker and is formatted from minor units. The verification
 * badge reads `ListingBadge`, which says "unverified" and cannot say otherwise.
 * And the invented star rating and review count are labelled as sample figures
 * wherever they appear, because a rating nobody left is a commercial signal
 * this product does not get to manufacture.
 *
 * Images come from the CDN the export shipped with — see ADR-025 — so each one
 * sits on a tinted plate that reads as intentional if the CDN is unreachable.
 * A *live* listing has no image at all and renders on that plate permanently:
 * a real supplier's experience has no licensed photograph, and giving it a
 * stock one is what ADR-025 scoped away.
 *
 * Currency is read from the listing rather than assumed. The content set is
 * USD; the live catalogue is in the property's own currency, and rendering
 * pesos under a dollar sign would be a lie about a price.
 */

const HOVER_IMAGE =
  'absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]'

export function DestinationCard({
  destination,
  locale,
  size = 'default',
}: {
  destination: Destination
  locale: AppLocale
  size?: 'default' | 'tall' | 'wide'
}) {
  const aspect =
    size === 'tall' ? 'aspect-[3/4]' : size === 'wide' ? 'aspect-[16/10]' : 'aspect-[4/5]'

  return (
    <Link href={`/destinations/${destination.slug}`} className="group block">
      <div className={cn('bg-sand relative overflow-hidden rounded-2xl', aspect)}>
        <Image
          src={destination.image}
          alt={`${destination.name}, ${destination.country}`}
          fill
          sizes="(max-width: 768px) 80vw, 40vw"
          className={HOVER_IMAGE}
        />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-ink/75 to-transparent" />
        <div className="absolute top-3 right-3">
          <SaveButton
            kind="destinations"
            slug={destination.slug}
            label={destination.name}
            locale={locale}
          />
        </div>
        <div className="text-ivory absolute inset-x-0 bottom-0 p-5">
          <p className="text-ivory/80 text-xs">
            {destination.country} · {destination.region}
          </p>
          <h3 className="mt-1 text-2xl leading-tight md:text-[28px]">{destination.name}</h3>
        </div>
      </div>
      <p className="text-muted mt-3 line-clamp-2 text-sm leading-relaxed">{destination.tagline}</p>
      <p className="text-ink mt-1 text-sm">
        <Money
          amountMinor={destination.dailyFromMinor}
          currency={CONTENT_CURRENCY}
          locale={locale}
          intent="potential"
        />{' '}
        <span className="text-muted">· illustrative, per person per day</span>
      </p>
    </Link>
  )
}

export function PropertyCard({
  property,
  locale,
  layout = 'card',
}: {
  property: Property
  locale: AppLocale
  layout?: 'card' | 'row'
}) {
  const t = createTranslator(locale)
  const destination = getDestination(property.destination)
  const cover = property.images[0]

  if (layout === 'row') {
    return (
      <Link
        href={`/stays/${property.slug}`}
        className="hover:bg-paper group flex gap-4 rounded-xl p-3 transition-colors duration-150"
      >
        <div className="bg-sand relative size-24 shrink-0 overflow-hidden rounded-lg">
          {cover ? (
            <Image src={cover} alt={property.name} fill sizes="96px" className="object-cover" />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col">
          <p className="text-muted text-xs">
            {property.type} · {destination?.name}
          </p>
          <p className="truncate text-lg leading-tight">{property.name}</p>
          <p className="mt-auto text-sm">
            <Money
              amountMinor={property.pricePerNightMinor}
              currency={property.currency ?? CONTENT_CURRENCY}
              locale={locale}
              intent="potential"
            />{' '}
            <span className="text-muted">{t('explore.stay.perNight')}</span>
          </p>
        </div>
      </Link>
    )
  }

  return (
    <Link href={`/stays/${property.slug}`} className="group flex h-full flex-col">
      <div className="bg-sand relative aspect-4/3 overflow-hidden rounded-2xl">
        {cover ? (
          <Image
            src={cover}
            alt={property.name}
            fill
            sizes="(max-width: 768px) 80vw, 25vw"
            className={HOVER_IMAGE}
          />
        ) : null}
        <div className="absolute top-3 left-3">
          <ListingBadge
            status={property.verification}
            provenance={property.provenance}
            locale={locale}
            onImage
          />
        </div>
        <div className="absolute top-3 right-3">
          <SaveButton kind="stays" slug={property.slug} label={property.name} locale={locale} />
        </div>
      </div>
      <div className="flex flex-1 flex-col pt-4">
        <div className="text-muted flex items-center justify-between gap-3 text-xs">
          <span className="truncate">
            {property.type} · {destination?.name}, {destination?.country}
          </span>
          {/*
            * A rating nobody gave. Labelled, never styled as social proof —
            * and absent entirely on a live listing, which has no reviews
            * because nobody has left one.
            */}
          {property.rating !== undefined ? (
            <span className="text-muted shrink-0 tabular-nums">
              {property.rating} ({property.reviews} sample)
            </span>
          ) : null}
        </div>
        <h3 className="mt-1.5 text-xl leading-snug">{property.name}</h3>
        <p className="text-muted mt-1.5 line-clamp-2 text-sm leading-relaxed">{property.summary}</p>
        <p className="mt-auto pt-3 text-sm">
          <Money
            amountMinor={property.pricePerNightMinor}
            currency={property.currency ?? CONTENT_CURRENCY}
            locale={locale}
            intent="potential"
          />{' '}
          <span className="text-muted">{t('explore.stay.perNight')}</span>
        </p>
      </div>
    </Link>
  )
}


/**
 * What a real supplier's listing shows where a photograph would be.
 *
 * ADR-025 and ADR-027 keep stock photography off a live listing: a licensed
 * image of a real place, taken by nobody connected to the business selling
 * the thing, is a claim the product has not earned. That decision is right
 * and is not being overturned here.
 *
 * What was wrong is what it looked like. Ten published listings — the only
 * part of the catalogue a visitor can actually buy — rendered as ten
 * identical blank beige rectangles, three across, directly above fifteen
 * illustrative ones that all had photographs. The commercial half of the page
 * read as a failed load while the decorative half looked finished.
 *
 * So the absence is drawn on purpose: a category mark, the category named,
 * and one line saying why there is nothing here. A visitor who reads it
 * learns something true about ARC. A visitor who does not at least sees a
 * card somebody designed.
 *
 * Purely decorative, so the mark is `aria-hidden` and the caption carries the
 * meaning.
 */
const CATEGORY_MARK: Record<ExperienceCategory, typeof Compass> = {
  Adventure: Mountain,
  Culture: Landmark,
  Wellness: Leaf,
  Food: UtensilsCrossed,
  Nature: Compass,
  Transport: Car,
}

function ListingPlate({
  category,
  locale,
}: {
  category: ExperienceCategory
  locale: AppLocale
}) {
  const t = createTranslator(locale)
  const Mark = CATEGORY_MARK[category] ?? Compass

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
      {/* A quiet repeating rule, so the plate is a surface rather than a gap. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 9px)',
        }}
      />
      <Mark className="text-muted relative size-7" aria-hidden />
      <p className="text-muted relative text-[11px] leading-relaxed">
        {t('explore.listing.noPhoto')}
      </p>
    </div>
  )
}

export function ExperienceCard({
  experience,
  locale,
}: {
  experience: Experience
  locale: AppLocale
}) {
  const t = createTranslator(locale)
  const destination = getDestination(experience.destination)

  return (
    <Link href={`/experiences/${experience.slug}`} className="group flex h-full flex-col">
      <div className="bg-sand relative aspect-5/4 overflow-hidden rounded-2xl">
        {experience.image ? (
          <Image
            src={experience.image}
            alt={experience.title}
            fill
            sizes="(max-width: 768px) 80vw, 33vw"
            className={HOVER_IMAGE}
          />
        ) : (
          <ListingPlate category={experience.category} locale={locale} />
        )}
        <div className="absolute top-3 left-3">
          <ListingBadge
            status={experience.verification}
            provenance={experience.provenance}
            locale={locale}
            onImage
          />
        </div>
        <div className="absolute top-3 right-3">
          <SaveButton
            kind="experiences"
            slug={experience.slug}
            label={experience.title}
            locale={locale}
          />
        </div>
        <span className="bg-ivory/95 text-ink absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-[11px]">
          {experience.category} · {experience.activity}
        </span>
      </div>
      <div className="flex flex-1 flex-col pt-4">
        <p className="text-muted text-xs">
          {destination?.name}, {destination?.country}
        </p>
        <h3 className="mt-1 text-xl leading-snug">{experience.title}</h3>
        <div className="text-muted mt-2 flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5" aria-hidden />
            {experience.duration}
          </span>
          <span className="flex items-center gap-1.5">
            <Gauge className="size-3.5" aria-hidden />
            {experience.difficulty}
          </span>
        </div>
        <p className="mt-auto pt-3 text-sm">
          <Money
            amountMinor={experience.priceMinor}
            currency={experience.currency ?? CONTENT_CURRENCY}
            locale={locale}
            intent="potential"
          />{' '}
          <span className="text-muted">{t('explore.experience.perPerson')}</span>
        </p>
      </div>
    </Link>
  )
}
