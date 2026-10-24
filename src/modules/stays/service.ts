import { prisma } from '@/lib/db'
import { conflict, invalid, notFound } from '@/lib/errors'
import { fromDateKey, toDateKey, type DateKey } from '@/lib/dates'
import { portalToken, stayReference } from '@/lib/ids'
import { Role, StayStatus } from '@/lib/prisma-types'
import { assertPropertyAccess, type ActorContext } from '@/modules/tenancy/context'
import { recordAudit } from '@/modules/workflows/audit'
import { PORTAL_GRACE_DAYS } from '@/modules/guest/portal'
import { stayInputSchema, stayStatusSchema } from './schemas'

/**
 * Guest and stay provisioning: the front desk's write path.
 *
 * Until this existed, no route in the product created a `Guest` or a `Stay` —
 * only `prisma/seed.ts` did. Since a stay's `portalToken` is what the guest
 * portal resolves, that meant the entire guest surface was unreachable for a
 * real guest: step five of the commercial journey had no implementation at all.
 *
 * Three things govern this file:
 *
 *   1. **The token is a credential.** It is 24 random bytes (`portalToken()`),
 *      never derived from the guest's details, and it is returned exactly once
 *      per call — to the person at the desk who is about to hand it over. The
 *      seed's deterministic tokens are a demo affordance and the seed now
 *      refuses to run outside demo mode.
 *   2. **A guest is per property, not per stay.** `Guest` is unique on
 *      `(propertyId, email)`, so a returning guest keeps their preferences and
 *      their intake rather than starting again. A second stay reuses the row
 *      and gets its own token.
 *   3. **Reissuing invalidates.** Replacing a token is the answer to a
 *      photographed key card, so `reissuePortalToken` overwrites rather than
 *      adding, and says so.
 */
export interface ProvisionedStay {
  stayId: string
  guestId: string
  reference: string
  /**
   * The portal token, returned only here. Everything else that needs to show
   * the link reads it from the stay row for the property it has access to.
   */
  portalToken: string
  checkIn: DateKey
  checkOut: DateKey
  /** Last day the portal link works: check-out plus the grace window. */
  portalExpiresOn: DateKey
}

const expiryOf = (checkOut: DateKey): DateKey =>
  toDateKey(new Date(fromDateKey(checkOut).getTime() + PORTAL_GRACE_DAYS * 86_400_000))

/**
 * Creates (or reuses) the guest, creates the stay, and mints its portal token.
 *
 * One transaction: a guest with no stay is a contact nobody asked for, and a
 * stay with no guest cannot exist. The reference is retried on collision rather
 * than assumed unique — it is short enough to be read down a phone, which means
 * it is short enough to collide.
 */
export async function createStay(
  actor: ActorContext,
  propertyId: string,
  raw: unknown,
): Promise<ProvisionedStay> {
  const input = stayInputSchema.parse(raw)
  const { organizationId } = await assertPropertyAccess(
    actor,
    propertyId,
    Role.OWNER,
    Role.STAFF,
    Role.ADMIN,
  )

  if (input.roomTypeId) {
    const roomType = await prisma.roomType.findFirst({
      where: { id: input.roomTypeId, propertyId },
      select: { id: true },
    })
    // A room type from another property is not an error the guest should see as
    // "unavailable"; it is not this property's to use.
    if (!roomType) throw notFound('Room type')
  }

  const token = portalToken()

  const result = await prisma.$transaction(async (tx) => {
    const guest = await tx.guest.upsert({
      where: { propertyId_email: { propertyId, email: input.email } },
      create: {
        organizationId,
        propertyId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone ?? null,
        locale: input.locale,
        countryCode: input.countryCode ?? null,
        partySize: input.adults + input.children,
      },
      // A returning guest keeps their intake. Only the facts the desk has just
      // confirmed are updated, and nothing the guest told us is overwritten.
      update: {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone ?? undefined,
        locale: input.locale,
        countryCode: input.countryCode ?? undefined,
        partySize: input.adults + input.children,
      },
      select: { id: true },
    })

    let stay: { id: string; reference: string } | null = null
    for (let attempt = 0; attempt < 5 && !stay; attempt += 1) {
      try {
        stay = await tx.stay.create({
          data: {
            organizationId,
            propertyId,
            guestId: guest.id,
            roomTypeId: input.roomTypeId ?? null,
            reference: stayReference(),
            checkIn: fromDateKey(input.checkIn),
            checkOut: fromDateKey(input.checkOut),
            adults: input.adults,
            children: input.children,
            roomRevenueMinor: input.roomRevenueMinor,
            portalToken: token,
            arrivalNotes: input.arrivalNotes ?? null,
            status: StayStatus.BOOKED,
          },
          select: { id: true, reference: true },
        })
      } catch (error) {
        // P2002 on `reference` is a collision in a deliberately short code;
        // on `portalToken` it is 24 random bytes and means something is wrong.
        const target = (error as { code?: string; meta?: { target?: string[] } })
        if (target.code !== 'P2002' || !target.meta?.target?.includes('reference')) throw error
      }
    }
    if (!stay) throw conflict('Could not allocate a stay reference. Try again.')

    await recordAudit(
      {
        organizationId,
        actor,
        action: 'stay.created',
        entityType: 'Stay',
        entityId: stay.id,
        metadata: {
          propertyId,
          guestId: guest.id,
          reference: stay.reference,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          adults: input.adults,
          children: input.children,
          // Field names, not values: the guest's own details are not audit data.
          providedFields: Object.keys(input).filter((k) => k !== 'arrivalNotes'),
        },
      },
      tx,
    )

    return { stayId: stay.id, guestId: guest.id, reference: stay.reference }
  })

  return {
    ...result,
    portalToken: token,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    portalExpiresOn: expiryOf(input.checkOut),
  }
}

/**
 * Replaces a stay's portal token.
 *
 * The answer to a photographed key card or a link forwarded to the wrong
 * person: the previous token stops resolving the moment this returns, because
 * the column holds exactly one.
 */
export async function reissuePortalToken(
  actor: ActorContext,
  stayId: string,
): Promise<{ portalToken: string; reference: string }> {
  const stay = await prisma.stay.findUnique({
    where: { id: stayId },
    select: { id: true, propertyId: true, reference: true, status: true },
  })
  if (!stay) throw notFound('Stay')

  const { organizationId } = await assertPropertyAccess(
    actor,
    stay.propertyId,
    Role.OWNER,
    Role.STAFF,
    Role.ADMIN,
  )

  if (stay.status === StayStatus.CANCELLED || stay.status === StayStatus.NO_SHOW) {
    throw invalid('That stay is closed, so a new link would not open anything.')
  }

  const token = portalToken()

  await prisma.$transaction(async (tx) => {
    await tx.stay.update({ where: { id: stay.id }, data: { portalToken: token } })
    await recordAudit(
      {
        organizationId,
        actor,
        action: 'stay.portal_token.reissued',
        entityType: 'Stay',
        entityId: stay.id,
        // Never the token itself, old or new.
        metadata: { reference: stay.reference },
      },
      tx,
    )
  })

  return { portalToken: token, reference: stay.reference }
}

/** Moves a stay through its lifecycle: booked → in house → checked out. */
export async function setStayStatus(actor: ActorContext, raw: unknown): Promise<void> {
  const input = stayStatusSchema.parse(raw)

  const stay = await prisma.stay.findUnique({
    where: { id: input.stayId },
    select: { id: true, propertyId: true, status: true, reference: true },
  })
  if (!stay) throw notFound('Stay')

  const { organizationId } = await assertPropertyAccess(
    actor,
    stay.propertyId,
    Role.OWNER,
    Role.STAFF,
    Role.ADMIN,
  )

  /*
   * Which transitions are allowed, stated rather than implied.
   *
   * A status field with no transition table is a field that will eventually
   * hold CHECKED_OUT for a guest who never arrived, and the arrivals board
   * reads it.
   */
  const ALLOWED: Record<StayStatus, StayStatus[]> = {
    [StayStatus.BOOKED]: [StayStatus.IN_HOUSE, StayStatus.CANCELLED, StayStatus.NO_SHOW],
    [StayStatus.IN_HOUSE]: [StayStatus.CHECKED_OUT, StayStatus.CANCELLED],
    [StayStatus.CHECKED_OUT]: [],
    [StayStatus.CANCELLED]: [],
    [StayStatus.NO_SHOW]: [],
  }

  if (stay.status === input.status) return
  if (!ALLOWED[stay.status].includes(input.status)) {
    throw invalid(
      `A ${stay.status.toLowerCase().replace('_', ' ')} stay cannot become ${input.status
        .toLowerCase()
        .replace('_', ' ')}.`,
    )
  }

  await prisma.$transaction(async (tx) => {
    await tx.stay.update({ where: { id: stay.id }, data: { status: input.status } })
    await recordAudit(
      {
        organizationId,
        actor,
        action: 'stay.status.changed',
        entityType: 'Stay',
        entityId: stay.id,
        metadata: { reference: stay.reference, from: stay.status, to: input.status },
      },
      tx,
    )
  })
}

/**
 * The stays the desk is working with, and whether each portal link is live.
 *
 * Includes the token, because the person looking at this board is the person
 * who hands the link over. It is scoped by `assertPropertyAccess` like
 * everything else on the operator surface.
 */
export async function listStays(
  actor: ActorContext,
  propertyId: string,
  options: { from?: DateKey; days?: number; now?: Date } = {},
) {
  await assertPropertyAccess(actor, propertyId, Role.OWNER, Role.STAFF, Role.ADMIN)

  const now = options.now ?? new Date()
  const from = options.from ?? toDateKey(new Date(now.getTime() - 3 * 86_400_000))
  const days = options.days ?? 45

  const stays = await prisma.stay.findMany({
    where: {
      propertyId,
      checkIn: {
        gte: fromDateKey(from),
        lt: new Date(fromDateKey(from).getTime() + days * 86_400_000),
      },
    },
    orderBy: [{ checkIn: 'asc' }, { reference: 'asc' }],
    select: {
      id: true,
      reference: true,
      checkIn: true,
      checkOut: true,
      adults: true,
      children: true,
      status: true,
      portalToken: true,
      roomType: { select: { code: true, name: true } },
      guest: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          locale: true,
          intakeCompletedAt: true,
        },
      },
    },
  })

  return stays.map((stay) => {
    const checkOut = toDateKey(stay.checkOut)
    const expiresOn = expiryOf(checkOut)
    return {
      ...stay,
      checkIn: toDateKey(stay.checkIn),
      checkOut,
      portalExpiresOn: expiresOn,
      portalLive:
        stay.status !== StayStatus.CANCELLED &&
        stay.status !== StayStatus.NO_SHOW &&
        toDateKey(now) <= expiresOn,
    }
  })
}
