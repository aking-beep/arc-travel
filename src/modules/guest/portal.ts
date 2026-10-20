import { prisma } from '@/lib/db'
import { notFound } from '@/lib/errors'
import { fromPrismaLocale, type AppLocale } from '@/lib/i18n'
import { daysBetween, toDateKey, type DateKey } from '@/lib/dates'
import { StayStatus } from '@/lib/prisma-types'

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

export interface PortalContext {
  stayId: string
  reference: string
  guestId: string
  propertyId: string
  organizationId: string
  guestFirstName: string
  guestLastName: string
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
          firstName: true,
          lastName: true,
          locale: true,
          partySize: true,
          intakeCompletedAt: true,
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
      supplier: { select: { id: true, name: true, verification: true } },
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
