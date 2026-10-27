import type { AppLocale } from '@/lib/i18n'
import { ExperienceCategory as DbCategory, AbilityLevel, VerificationStatus } from '@/lib/prisma-types'
import { isCurrentlyVerified } from '@/modules/admin/verification'
import {
  getPublicExperience,
  getPublicProperty,
  listPublicExperiences,
  PUBLIC_DESTINATION,
} from './service'
import type {
  Difficulty,
  Experience,
  ExperienceCategory,
  Property,
  PropertyType,
} from './content/types'

/**
 * The bridge between the published catalogue and the public surface.
 *
 * `modules/discovery/service.ts` is a tested, database-backed read model of the
 * published catalogue, and until this existed no route rendered it: the public
 * surface ran entirely on the illustrative content set, so the one destination
 * this build has real data for was showing fixtures. That was the largest
 * architectural gap in the readiness audit.
 *
 * This maps those rows into the content shapes the existing components already
 * render, so the pages gain live data without the components changing. Five
 * rules govern the mapping, and each one is a refusal:
 *
 *   1. **Nothing is invented to fill a field.** The database has no host
 *      biography, no years of experience, no itinerary breakdown and no
 *      photograph. Those fields are optional on the content types and are left
 *      empty here rather than filled with something plausible.
 *   2. **Claims stay claims.** `hostClaims` is the supplier's own
 *      `claimedCertifications`, passed through. `provenance` carries a
 *      verification status derived through `isCurrentlyVerified`, so a fixture
 *      supplier reaches the page as unverified, only an `/admin` decision can
 *      make it say otherwise, and a stored decision that has stopped being
 *      true stops being shown (ADR-036).
 *   3. **Currency travels with the price.** The content set is USD and the
 *      catalogue is in the property's own currency. The amount carries its
 *      currency so pesos are never rendered under a dollar sign.
 *   4. **An unpriced listing is not a listing.** A published experience with no
 *      active BASE price is omitted. A public catalogue entry with no price is
 *      not something a visitor can act on, and "price on request" from a
 *      product that has the price list is a worse answer than absence.
 *   5. **A rejected supplier is not shown.** The published-catalogue predicate
 *      does not exclude one, so this does.
 *
 * It returns **no availability**: no slots, no holds, no "places left". A
 * published price is a fact about a price list, not an offer on a date — see
 * the note at the top of `service.ts`.
 */

/** The content-set destination slug the live catalogue belongs to. */
export const LIVE_DESTINATION = PUBLIC_DESTINATION

/**
 * The database's category taxonomy, onto the content set's.
 *
 * Exhaustive over the Prisma enum on purpose: a new category in the schema
 * fails typecheck here rather than quietly landing in whichever bucket was
 * nearest. `TRANSPORT` is why the content union has a `Transport` member.
 */
const CATEGORY: Record<DbCategory, ExperienceCategory> = {
  [DbCategory.SURF]: 'Adventure',
  [DbCategory.ADVENTURE]: 'Adventure',
  [DbCategory.WELLNESS]: 'Wellness',
  [DbCategory.DINING]: 'Food',
  [DbCategory.CULTURE]: 'Culture',
  [DbCategory.TRANSPORT]: 'Transport',
}

/**
 * Ability demanded, onto the content set's four difficulty words.
 *
 * `IMPROVER` and `INTERMEDIATE` both read as "Moderate": the content union has
 * four members and the ability scale five, and collapsing the two adjacent
 * middle levels loses less than inventing a fifth word would. The detail page
 * shows the real ability range alongside.
 */
const DIFFICULTY: Record<AbilityLevel, Difficulty> = {
  [AbilityLevel.BEGINNER]: 'Easy',
  [AbilityLevel.IMPROVER]: 'Moderate',
  [AbilityLevel.INTERMEDIATE]: 'Moderate',
  [AbilityLevel.ADVANCED]: 'Challenging',
  [AbilityLevel.EXPERT]: 'Expert',
}

const pick = (locale: AppLocale, en: string | null, es: string | null): string =>
  (locale === 'es' ? es : null) ?? en ?? ''

/** Blank-line-separated prose into paragraphs. Empty in, empty out. */
const paragraphs = (text: string | null): string[] =>
  (text ?? '')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

function duration(minutes: number, locale: AppLocale): { duration: string; durationHours: number } {
  const hours = minutes / 60
  const rounded = Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
  return {
    durationHours: hours,
    duration: locale === 'es' ? `${rounded} h` : `${rounded} hr`,
  }
}

type ListRow = Awaited<ReturnType<typeof listPublicExperiences>>['items'][number]
type DetailRow = Awaited<ReturnType<typeof getPublicExperience>>

function included(row: {
  guideIncluded: boolean
  includesTransfer: boolean
  activity: { name: string }
}, locale: AppLocale): string[] {
  // Derived from booleans the catalogue actually holds, and nothing else. The
  // export's fixtures list five or six inclusions each; a live listing lists
  // what is recorded, which is usually two.
  const items: string[] = []
  if (row.guideIncluded) {
    items.push(locale === 'es' ? 'Guía incluido' : 'Guide included')
  }
  if (row.includesTransfer) {
    items.push(locale === 'es' ? 'Traslado incluido' : 'Transfer included')
  }
  return items
}

/**
 * The status a public card may claim.
 *
 * `VERIFIED` only while the stored decision is still current. A `VERIFIED` row
 * whose insurance certificate has expired, or whose checklist is incomplete,
 * reads as `UNVERIFIED` here — which is what the guest portal, the basket and
 * the booking page have said since ADR-036's amendment, and what the public
 * storefront did not. It read the column, so the one surface a stranger sees
 * was the one surface that would have gone on printing a lapsed badge.
 *
 * Downgraded rather than hidden: a lapse changes presentation, not data, and
 * nothing is unpublished over it (non-negotiable 6).
 */
function publicVerification(
  supplier: { verification: VerificationStatus; verifiedChecks: readonly string[]; insuranceExpiresOn: Date | null },
  now: Date,
): VerificationStatus {
  if (isCurrentlyVerified(supplier, now)) return VerificationStatus.VERIFIED
  return supplier.verification === VerificationStatus.VERIFIED
    ? VerificationStatus.UNVERIFIED
    : supplier.verification
}

function toExperience(row: ListRow, locale: AppLocale, now: Date): Experience | null {
  const price = row.prices[0]
  if (!price) return null
  if (row.supplier.verification === VerificationStatus.REJECTED) return null

  return {
    slug: row.slug,
    title: pick(locale, row.titleEn, row.titleEs),
    destination: LIVE_DESTINATION,
    category: CATEGORY[row.category],
    activity: row.activity.name,
    verification: 'illustrative',
    priceMinor: price.amountMinor,
    currency: price.currency,
    ...duration(row.durationMinutes, locale),
    difficulty: DIFFICULTY[row.minAbility],
    groupSize: `${row.minParty}–${row.maxParty}`,
    summary: pick(locale, row.summaryEn, row.summaryEs),
    description: [],
    host: { name: row.supplier.name },
    itinerary: [],
    meetingPoint: row.place?.name ?? '',
    // The supplier's own claims, as claims. Never re-labelled as certification.
    hostClaims: row.supplier.claimedCertifications,
    included: included(row, locale),
    provenance: { kind: 'live', verification: publicVerification(row.supplier, now) },
  }
}

/**
 * The published catalogue as experience cards.
 *
 * Takes the same query object `listPublicExperiences` does, so a filter applied
 * on the page is applied in the query rather than over an array in a component.
 */
export async function liveExperiences(
  locale: AppLocale,
  query: Record<string, string | undefined> = {},
): Promise<Experience[]> {
  const { items } = await listPublicExperiences(query)
  /*
   * One instant for the whole list, read here rather than per row: two cards
   * on the same page disagreeing about whether a certificate has expired would
   * be a worse bug than either answer.
   */
  const now = new Date()
  return items
    .map((row) => toExperience(row, locale, now))
    .filter((item): item is Experience => item !== null)
}

/** One published experience, or null — never a throw, so a page can fall through to content. */
export async function liveExperience(
  slug: string,
  locale: AppLocale,
): Promise<Experience | null> {
  let row: DetailRow
  try {
    row = await getPublicExperience(slug)
  } catch {
    // `getPublicExperience` throws `notFound` for an unpublished or unknown
    // slug. Here that is not an error: the slug may belong to the content set,
    // and the caller tries that next.
    return null
  }

  const base = toExperience(row, locale, new Date())
  if (!base) return null

  return {
    ...base,
    description: paragraphs(pick(locale, row.descriptionEn, row.descriptionEs)),
    meetingPoint: row.meetingPoint ?? row.place?.name ?? '',
    host: {
      name: row.supplier.name,
      // `bio` only when the supplier wrote one. No `role`, no `years`: the
      // database does not hold them and a real person's biography is not
      // something to fill in.
      ...(row.supplier.description ? { bio: row.supplier.description } : {}),
    },
    included: [
      ...base.included,
      ...paragraphs(pick(locale, row.whatToBringEn, row.whatToBringEs)).map((line) =>
        locale === 'es' ? `Traer: ${line}` : `Bring: ${line}`,
      ),
    ],
  }
}

/**
 * The destination's one real property, as a stay card.
 *
 * `type` is `'Boutique Hotel'`, which is what the product is for and the only
 * one of the content set's seven types the database could honestly be read as.
 * The schema has no property-type column; inferring "Surf Lodge" from a name
 * would be a guess about somebody's business.
 *
 * The locale is accepted and unused: `Property` is single-language in the
 * content set, and the columns this reads (`tagline`, `description`,
 * `checkInTime`) have no translated pair. It stays in the signature so adding
 * those columns is a change to one function rather than to every caller.
 */
export async function liveStay(_locale: AppLocale): Promise<Property | null> {
  let property: Awaited<ReturnType<typeof getPublicProperty>>
  try {
    property = await getPublicProperty()
  } catch {
    return null
  }

  const from = property.rateRange?.min
  if (!from) return null

  return {
    slug: property.slug,
    name: property.name,
    destination: LIVE_DESTINATION,
    type: 'Boutique Hotel' satisfies PropertyType,
    verification: 'illustrative',
    images: [],
    pricePerNightMinor: from.amountMinor,
    currency: from.currency,
    // No rating, no review count: nobody has left one.
    summary: property.tagline ?? '',
    description: paragraphs(property.description),
    amenities: property.amenities.map((amenity) => amenity.name),
    rooms: property.roomTypes.map((room) => ({
      name: room.name,
      sleeps: room.maxOccupancy,
      // The schema has no room size. An invented square-metre figure is a
      // claim about a building.
      size: '—',
      priceMinor: room.baseRateMinor,
      note: room.description ?? '',
    })),
    location: property.place?.name ?? '',
    highlights: [],
    checkIn: property.checkInTime,
    checkOut: property.checkOutTime,
    provenance: { kind: 'live', verification: property.verification },
  }
}

/** The live stays as a list, so a page can concatenate it with the content set. */
export async function liveStays(locale: AppLocale): Promise<Property[]> {
  const stay = await liveStay(locale)
  return stay ? [stay] : []
}
