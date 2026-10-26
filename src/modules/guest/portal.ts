import { prisma } from '@/lib/db'
import { notFound, rateLimited } from '@/lib/errors'
import {
  assertWithinRateLimit,
  consumeRateLimit,
  peekRateLimit,
  rateLimitSubject,
} from '@/lib/rate-limit'
import { fromPrismaLocale, type AppLocale } from '@/lib/i18n'
import { daysBetween, toDateKey, type DateKey } from '@/lib/dates'
import { StayStatus } from '@/lib/prisma-types'
import { VERIFICATION_STANDING_SELECT } from '@/modules/admin/verification'

/**
 * Guest portal context.
 *
 * The portal is reached from a QR code at the front desk, so the stay's
 * `portalToken` is the guest's only credential. That makes this function the
 * entire authorisation boundary for the guest surface, and it is why the token
 * is opaque, single-purpose and scoped to one stay: holding it grants access to
 * that stay's plan and basket, and to nothing else in the tenant.
 */
/**
 * Days after check-out that the portal stays readable.
 *
 * Long enough for a guest to look up a receipt on the flight home, short
 * enough that a QR code photographed at a front desk months ago is not a
 * standing credential. The token is time-boxed as well as scoped.
 */
export const PORTAL_GRACE_DAYS = 7

/**
 * Per-caller ceilings on portal token resolution.
 *
 * A portal token is the guest surface's only credential, so an unlimited
 * number of guesses per minute is the one brute-force surface the product has.
 * Two buckets: every attempt, at a ceiling a real guest will never reach, and
 * *failed* attempts, at a much tighter one — a guest with a valid QR code never
 * misses, so a caller that misses ten times in a minute is enumerating.
 *
 * The caller's address is hashed before it is stored (`rateLimitSubject`): a
 * counter does not need to know who anyone is.
 */
export const PORTAL_ATTEMPTS_PER_MINUTE = 120
export const PORTAL_MISSES_PER_MINUTE = 10

/**
 * Guards one portal token resolution for one caller.
 *
 * Called from the app layer, which is the only place that can see a request
 * header. `clientKey` is whatever identifies the caller there — the
 * `x-forwarded-for` address in a hosted deployment. Null means the runtime
 * gave us nothing to key on, and an unkeyable caller is not refused: dropping
 * every anonymous request would be a worse failure than the one being
 * prevented.
 */
export async function guardPortalAttempt(clientKey: string | null, now = new Date()): Promise<void> {
  if (!clientKey) return
  const subject = rateLimitSubject(clientKey)

  // Read, not consume: checking whether a caller is over their failure ceiling
  // must not itself count as a failure. `recordPortalMiss` is the only writer
  // of this bucket. Checked first, so a caller already over it cannot keep
  // probing by spending the wider allowance.
  const misses = await peekRateLimit({
    bucket: `portal-miss:${subject}`,
    limit: PORTAL_MISSES_PER_MINUTE,
    windowSeconds: 60,
    now,
  })
  if (!misses.allowed) {
    throw rateLimited('Too many attempts. Wait a minute and open the link from your QR code again.')
  }

  await assertWithinRateLimit({
    bucket: `portal:${subject}`,
    limit: PORTAL_ATTEMPTS_PER_MINUTE,
    windowSeconds: 60,
    message: 'Too many requests. Try again shortly.',
    now,
  })
}

/** Counts a failed resolution against the caller's tighter ceiling. */
export async function recordPortalMiss(clientKey: string | null, now = new Date()): Promise<void> {
  if (!clientKey) return
  await consumeRateLimit({
    bucket: `portal-miss:${rateLimitSubject(clientKey)}`,
    limit: PORTAL_MISSES_PER_MINUTE,
    windowSeconds: 60,
    now,
  })
}

export interface PortalContext {
  stayId: string
  reference: string
  guestId: string
  propertyId: string
  organizationId: string
  guestFirstName: string
  guestLastName: string
  guestEmail: string
  /**
   * Whether somebody actually holds an ARC account for this guest (ADR-039).
   *
   * Not simply `guest.userId !== null`. The front desk and the demo seed both
   * create a credential-free `User` so the guest has an identity to act
   * under, and that placeholder is nobody's account — treating it as claimed
   * would mean every guest the desk ever entered could never sign up, which
   * is the feature. `holdsAccount` in `./account.ts` makes the same
   * distinction, from the other side.
   *
   * Deliberately a boolean and not the user id: the portal's authority is the
   * token, and nothing behind it should start branching on who the account
   * holder is. The portal uses this for one thing — whether to make the
   * offer.
   */
  hasAccount: boolean
  locale: AppLocale
  partySize: number
  intakeCompleted: boolean
  checkIn: DateKey
  checkOut: DateKey
  status: StayStatus
  property: {
    id: string
    name: string
    tagline: string | null
    description: string | null
    houseNotes: string | null
    brandPrimary: string
    brandAccent: string
    checkInTime: string
    checkOutTime: string
    currency: string
    contactPhone: string | null
    placeId: string | null
    placeName: string | null
  }
  /** The window the itinerary covers: the stay, clipped to today onwards. */
  planningStart: DateKey
  planningEnd: DateKey
}

export async function resolvePortalContext(token: string, now = new Date()): Promise<PortalContext> {
  // Tokens are opaque and fixed-shape; reject anything unlike one before
  // touching the database.
  if (!token || token.length < 8 || token.length > 64 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw notFound('Stay')
  }

  const stay = await prisma.stay.findUnique({
    where: { portalToken: token },
    select: {
      id: true,
      reference: true,
      checkIn: true,
      checkOut: true,
      status: true,
      adults: true,
      children: true,
      organizationId: true,
      propertyId: true,
      guest: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          locale: true,
          partySize: true,
          intakeCompletedAt: true,
          user: { select: { email: true, passwordHash: true } },
        },
      },
      property: {
        select: {
          id: true,
          name: true,
          tagline: true,
          description: true,
          houseNotes: true,
          brandPrimary: true,
          brandAccent: true,
          checkInTime: true,
          checkOutTime: true,
          currency: true,
          contactPhone: true,
          placeId: true,
          place: { select: { name: true } },
        },
      },
    },
  })

  if (!stay) throw notFound('Stay')

  // The token is not a general-purpose login. It stops working when the stay
  // is cancelled or the guest never arrived, and it expires shortly after
  // check-out: a QR code photographed at a front desk months ago must not
  // still open a live basket.
  if (stay.status === StayStatus.CANCELLED || stay.status === StayStatus.NO_SHOW) {
    throw notFound('Stay')
  }

  const today = toDateKey(now)
  const checkIn = toDateKey(stay.checkIn)
  const checkOut = toDateKey(stay.checkOut)

  if (daysBetween(checkOut, today) > PORTAL_GRACE_DAYS) {
    throw notFound('Stay')
  }

  return {
    stayId: stay.id,
    reference: stay.reference,
    guestId: stay.guest.id,
    propertyId: stay.propertyId,
    organizationId: stay.organizationId,
    guestFirstName: stay.guest.firstName,
    guestLastName: stay.guest.lastName,
    guestEmail: stay.guest.email,
    hasAccount: Boolean(
      stay.guest.user?.passwordHash ||
        (stay.guest.user &&
          stay.guest.user.email.toLowerCase() !== stay.guest.email.toLowerCase()),
    ),
    locale: fromPrismaLocale(stay.guest.locale),
    partySize: Math.max(1, stay.adults + stay.children, stay.guest.partySize),
    intakeCompleted: Boolean(stay.guest.intakeCompletedAt),
    checkIn,
    checkOut,
    status: stay.status,
    property: {
      id: stay.property.id,
      name: stay.property.name,
      tagline: stay.property.tagline,
      description: stay.property.description,
      houseNotes: stay.property.houseNotes,
      brandPrimary: stay.property.brandPrimary,
      brandAccent: stay.property.brandAccent,
      checkInTime: stay.property.checkInTime,
      checkOutTime: stay.property.checkOutTime,
      currency: stay.property.currency,
      contactPhone: stay.property.contactPhone,
      placeId: stay.property.placeId,
      placeName: stay.property.place?.name ?? null,
    },
    // Never plan into the past: a guest mid-stay wants the rest of their trip.
    planningStart: today > checkIn ? today : checkIn,
    planningEnd: checkOut,
  }
}

/** The published catalog as a guest sees it, with conditions-aware notes. */
export async function listGuestCatalog(propertyId: string) {
  return prisma.experience.findMany({
    where: { propertyId, status: 'PUBLISHED' },
    orderBy: [{ category: 'asc' }, { titleEn: 'asc' }],
    select: {
      id: true,
      slug: true,
      titleEn: true,
      titleEs: true,
      summaryEn: true,
      summaryEs: true,
      category: true,
      durationMinutes: true,
      minAbility: true,
      maxAbility: true,
      minParty: true,
      maxParty: true,
      minAgeYears: true,
      includesTransfer: true,
      guideIncluded: true,
      meetingPoint: true,
      imageUrl: true,
      supplier: { select: { id: true, name: true, ...VERIFICATION_STANDING_SELECT } },
      place: { select: { id: true, name: true, kind: true } },
      activity: { select: { name: true, guideRequired: true, maxSafeRisk: true, physicalIntensity: true } },
      prices: {
        where: { isActive: true },
        orderBy: [{ minParty: 'asc' }],
        select: { kind: true, amountMinor: true, bookingFeeMinor: true, currency: true, minParty: true },
      },
      _count: { select: { slots: true } },
    },
  })
}

export async function getGuestExperience(propertyId: string, slug: string) {
  const experience = await prisma.experience.findUnique({
    where: { propertyId_slug: { propertyId, slug } },
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
          description: true,
          verification: true,
          verifiedChecks: true,
          insuranceExpiresOn: true,
          claimedCertifications: true,
          insuranceOnFile: true,
        },
      },
      place: true,
      activity: true,
      prices: { where: { isActive: true }, orderBy: { minParty: 'asc' } },
      slots: {
        where: { startsAt: { gte: new Date() }, status: { in: ['OPEN', 'FULL'] } },
        orderBy: { startsAt: 'asc' },
        take: 60,
      },
    },
  })

  if (!experience || experience.status !== 'PUBLISHED') return null
  return experience
}
