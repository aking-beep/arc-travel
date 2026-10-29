import { prisma } from '@/lib/db'
import { conflict, forbidden, notFound } from '@/lib/errors'
import { reportError } from '@/lib/observability'
import {
  EmailKind,
  EntityStatus,
  InvitationKind,
  Role,
  StayKind,
  StayStatus,
  VerificationStatus,
} from '@/lib/prisma-types'
import { createInvitation } from '@/modules/auth/invitations'
import {
  canComposeEmail,
  dispatchQueued,
  publicUrl,
  queueEmail,
} from '@/modules/notifications/service'
import { partnerInvitation as partnerInvitationEmail } from '@/modules/notifications/templates'
import { assertOrganizationAccess, assertPropertyAccess, type ActorContext } from '@/modules/tenancy/context'
import { VERIFICATION_STANDING_SELECT } from '@/modules/admin/verification'
import { recordAudit } from '@/modules/workflows/audit'
import {
  amenitySchema,
  partnerInviteSchema,
  propertyProfileSchema,
  referenceLookupSchema,
  roomTypeSchema,
} from './schemas'

/**
 * Property and partner management for the owner surface.
 */

/**
 * Resolves which property the signed-in operator is working on.
 *
 * Owners usually have exactly one. Where a membership is pinned to a property
 * (front-desk staff) that pin wins, and an explicit id is honoured only after
 * the usual access check.
 */
export async function resolveOperatingProperty(
  actor: ActorContext,
  requestedPropertyId?: string,
): Promise<{ organizationId: string; propertyId: string }> {
  if (requestedPropertyId) {
    const { organizationId, propertyId } = await assertPropertyAccess(
      actor, requestedPropertyId, Role.OWNER, Role.STAFF, Role.ADMIN,
    )
    return { organizationId, propertyId }
  }

  const pinned = actor.memberships.find(
    (m) => m.propertyId && (m.role === Role.OWNER || m.role === Role.STAFF),
  )
  if (pinned?.propertyId) {
    return { organizationId: pinned.organizationId, propertyId: pinned.propertyId }
  }

  const organizationIds = actor.memberships
    .filter((m) => m.role === Role.OWNER || m.role === Role.STAFF || m.role === Role.ADMIN)
    .map((m) => m.organizationId)

  const property = await prisma.property.findFirst({
    where: actor.isPlatformAdmin ? {} : { organizationId: { in: organizationIds } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, organizationId: true },
  })

  if (!property) {
    throw forbidden('You are not a member of any property yet.')
  }
  return { organizationId: property.organizationId, propertyId: property.id }
}

export async function getPropertyOverview(actor: ActorContext, propertyId: string) {
  await assertPropertyAccess(actor, propertyId, Role.OWNER, Role.STAFF, Role.ADMIN)

  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    include: {
      organization: { select: { id: true, name: true, defaultCommissionBps: true } },
      place: { select: { id: true, name: true, kind: true } },
      roomTypes: { orderBy: { baseRateMinor: 'asc' } },
      amenities: { orderBy: { name: 'asc' }, include: { experience: { select: { id: true, titleEn: true, status: true } } } },
      _count: { select: { experiences: true, guests: true, stays: true, supplierAgreements: true } },
    },
  })
  if (!property) throw notFound('Property')
  return property
}

/**
 * Onboarding completeness.
 *
 * Five steps, each derived from stored facts rather than a progress flag, so an
 * owner cannot be shown "complete" for something they later deleted.
 */
export interface OnboardingStep {
  key: string
  label: string
  description: string
  done: boolean
  href: string
}

export async function getOnboardingState(
  actor: ActorContext,
  propertyId: string,
): Promise<{ steps: OnboardingStep[]; completed: number; total: number }> {
  await assertPropertyAccess(actor, propertyId, Role.OWNER, Role.STAFF, Role.ADMIN)

  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: {
      description: true,
      houseNotes: true,
      placeId: true,
      contactEmail: true,
      _count: { select: { roomTypes: true, supplierAgreements: true, amenities: true } },
    },
  })
  if (!property) throw notFound('Property')

  const [publishedCount, slotCount] = await Promise.all([
    prisma.experience.count({ where: { propertyId, status: 'PUBLISHED' } }),
    prisma.availabilitySlot.count({
      where: { experience: { propertyId }, startsAt: { gte: new Date() } },
    }),
  ])

  const steps: OnboardingStep[] = [
    {
      key: 'profile',
      label: 'Describe the property',
      description: 'Name, description, house notes and the neighbourhood it sits in.',
      done: Boolean(property.description && property.placeId && property.contactEmail),
      href: '/owner/property',
    },
    {
      key: 'rooms',
      label: 'Add room types',
      description: 'What you sell, how many of each, and the published nightly rate.',
      done: property._count.roomTypes > 0,
      href: '/owner/property#rooms',
    },
    {
      key: 'amenities',
      label: 'List your amenities',
      description: 'The raw material: what the hotel already offers, included or not.',
      done: property._count.amenities > 0,
      href: '/owner/property#amenities',
    },
    {
      key: 'partners',
      label: 'Invite local partners',
      description: 'The operators you already trust, with a commission split each.',
      done: property._count.supplierAgreements > 0,
      href: '/owner/partners',
    },
    {
      key: 'catalog',
      label: 'Publish your first experience',
      description: 'One priced, bookable thing a guest can actually add to a basket.',
      done: publishedCount > 0 && slotCount > 0,
      href: '/owner/catalog',
    },
  ]

  return { steps, completed: steps.filter((s) => s.done).length, total: steps.length }
}

export async function updatePropertyProfile(
  actor: ActorContext,
  propertyId: string,
  raw: unknown,
): Promise<void> {
  const { organizationId } = await assertPropertyAccess(
    actor, propertyId, Role.OWNER, Role.ADMIN,
  )
  const input = propertyProfileSchema.parse(raw)

  await prisma.$transaction(async (tx) => {
    await tx.property.update({
      where: { id: propertyId },
      data: {
        name: input.name,
        tagline: input.tagline ?? null,
        description: input.description ?? null,
        houseNotes: input.houseNotes ?? null,
        checkInTime: input.checkInTime,
        checkOutTime: input.checkOutTime,
        defaultLocale: input.defaultLocale,
        brandPrimary: input.brandPrimary,
        brandAccent: input.brandAccent,
        placeId: input.placeId ?? null,
        contactEmail: input.contactEmail || null,
        contactPhone: input.contactPhone ?? null,
      },
    })
    await recordAudit(
      {
        organizationId,
        actor,
        action: 'property.profile.updated',
        entityType: 'Property',
        entityId: propertyId,
        // Field names only: the values include guest-facing contact details.
        metadata: { fields: Object.keys(input) },
      },
      tx,
    )
  })
}

export async function upsertRoomType(
  actor: ActorContext,
  propertyId: string,
  raw: unknown,
): Promise<void> {
  const { organizationId } = await assertPropertyAccess(actor, propertyId, Role.OWNER, Role.ADMIN)
  const input = roomTypeSchema.parse(raw)

  await prisma.$transaction(async (tx) => {
    await tx.roomType.upsert({
      where: { propertyId_code: { propertyId, code: input.code } },
      update: {
        name: input.name,
        description: input.description ?? null,
        maxOccupancy: input.maxOccupancy,
        roomCount: input.roomCount,
        baseRateMinor: input.baseRateMinor,
      },
      create: {
        organizationId,
        propertyId,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        maxOccupancy: input.maxOccupancy,
        roomCount: input.roomCount,
        baseRateMinor: input.baseRateMinor,
        currency: 'MXN',
      },
    })

    // roomCount on the property is derived, so it can never disagree with the
    // sum of its room types.
    const total = await tx.roomType.aggregate({
      where: { propertyId },
      _sum: { roomCount: true },
    })
    await tx.property.update({
      where: { id: propertyId },
      data: { roomCount: total._sum.roomCount ?? 0 },
    })

    await recordAudit(
      {
        organizationId,
        actor,
        action: 'property.roomType.upserted',
        entityType: 'RoomType',
        entityId: null,
        metadata: { code: input.code, roomCount: input.roomCount },
      },
      tx,
    )
  })
}

export async function addAmenity(
  actor: ActorContext,
  propertyId: string,
  raw: unknown,
): Promise<void> {
  const { organizationId } = await assertPropertyAccess(
    actor, propertyId, Role.OWNER, Role.STAFF, Role.ADMIN,
  )
  const input = amenitySchema.parse(raw)

  await prisma.$transaction(async (tx) => {
    const created = await tx.amenity.create({
      data: {
        organizationId,
        propertyId,
        name: input.name,
        category: input.category,
        description: input.description ?? null,
        isIncluded: input.isIncluded,
      },
      select: { id: true },
    })
    await recordAudit(
      {
        organizationId,
        actor,
        action: 'property.amenity.created',
        entityType: 'Amenity',
        entityId: created.id,
        metadata: { name: input.name, category: input.category },
      },
      tx,
    )
  })
}

/**
 * Creates a partner and the agreement linking them to this property.
 *
 * The partner is created UNVERIFIED and with `payoutsEnabled: false`. An owner
 * saying they trust an operator is not the same as ARC having checked their
 * documents, and the product keeps those two facts apart.
 */
export interface PartnerInviteResult {
  supplierId: string
  /**
   * The invitation the partner needs to set their own password, present only
   * when this call created the account.
   *
   * Still returned even when it was also emailed, and the owner surface still
   * shows it. Mail is the convenience; the link in the owner's hands is the
   * thing that works when a partner's provider silently drops it, which for a
   * small business on a free mailbox is a real Tuesday. `emailStatus` says
   * which of the two happened so the page can stop claiming the wrong one.
   */
  invitation: { token: string; expiresAt: Date } | null
  /**
   * What became of the invitation email.
   *
   * `unconfigured` is the honest answer on a deployment with no mail set up,
   * and it is the one the owner surface must not render as "sent".
   */
  emailStatus: 'sent' | 'logged' | 'queued' | 'unconfigured' | 'failed' | null
}

export async function invitePartner(
  actor: ActorContext,
  propertyId: string,
  raw: unknown,
): Promise<PartnerInviteResult> {
  const { organizationId } = await assertPropertyAccess(actor, propertyId, Role.OWNER, Role.ADMIN)
  const input = partnerInviteSchema.parse(raw)

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { defaultCommissionBps: true },
  })

  const slugBase = input.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)

  const result = await prisma.$transaction(async (tx) => {
    let slug = slugBase || 'partner'
    for (let i = 1; i < 50; i += 1) {
      const clash = await tx.supplier.findUnique({ where: { slug }, select: { id: true } })
      if (!clash) break
      slug = `${slugBase}-${i + 1}`
    }

    /**
     * Create the contact, or refuse.
     *
     * This used to `upsert`, which meant an owner supplying any existing
     * user's email rewrote that person's name and phone — a cross-tenant write
     * to a row they have no claim on — and grafted a SUPPLIER membership onto
     * their account, exposing this organization's partner portal to them on
     * their next sign-in. An invitation cannot be a write to a stranger's
     * profile, so an email that is already claimed is refused and the owner is
     * told why.
     */
    const email = input.contactEmail.toLowerCase()
    const existing = await tx.user.findUnique({ where: { email }, select: { id: true } })

    if (existing) {
      const alreadyLinked = await tx.membership.findFirst({
        where: { userId: existing.id, organizationId, role: Role.SUPPLIER },
        select: { id: true },
      })
      if (!alreadyLinked) {
        throw conflict(
          `${input.contactEmail} already has an ARC account. Ask them to accept an invitation rather than adding them here, so their details are not overwritten.`,
        )
      }
    }

    const contact =
      existing ??
      (await tx.user.create({
        data: {
          email,
          name: input.contactName,
          phone: input.contactPhone ?? null,
          // The language the invitation and everything after it is written in.
          locale: input.contactLocale,
          // No password. ARC never invents a credential for someone else; the
          // invitation below is how this person takes the account over.
        },
        select: { id: true },
      }))

    const supplier = await tx.supplier.create({
      data: {
        organizationId,
        slug,
        name: input.name,
        description: input.description ?? null,
        categories: input.categories,
        contactUserId: contact.id,
        contactEmail: input.contactEmail.toLowerCase(),
        contactPhone: input.contactPhone ?? null,
        placeId: input.placeId ?? null,
        status: EntityStatus.PENDING_VERIFICATION,
        verification: VerificationStatus.UNVERIFIED,
        payoutsEnabled: false,
      },
      select: { id: true, name: true },
    })

    await tx.membership.create({
      data: { organizationId, userId: contact.id, supplierId: supplier.id, role: Role.SUPPLIER },
    })

    await tx.supplierAgreement.create({
      data: {
        organizationId,
        propertyId,
        supplierId: supplier.id,
        hotelCommissionBps: input.hotelCommissionBps,
        platformCommissionBps: 500,
        cancellationWindowHours: 24,
        requiresManualConfirmation: true,
        status: EntityStatus.PENDING_VERIFICATION,
      },
    })

    await recordAudit(
      {
        organizationId,
        actor,
        action: 'partner.invited',
        entityType: 'Supplier',
        entityId: supplier.id,
        metadata: {
          categories: input.categories,
          hotelCommissionBps: input.hotelCommissionBps,
          organizationDefaultBps: organization?.defaultCommissionBps,
        },
      },
      tx,
    )

    /*
     * A new contact gets an invitation; an existing account does not need one,
     * because the person already has a password of their own.
     */
    const invitation = existing
      ? null
      : await createInvitation(
          {
            userId: contact.id,
            kind: InvitationKind.SUPPLIER,
            organizationId,
            invitedById: actor.userId,
          },
          tx,
        )

    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      contactEmail: email,
      contactName: input.contactName,
      invitation: invitation ? { token: invitation.token, expiresAt: invitation.expiresAt } : null,
    }
  })

  /*
   * The email goes out after the transaction, never inside it.
   *
   * A `fetch` inside a transaction holds it open for the length of somebody
   * else's network, and a mail outage would roll back a partner record the
   * owner can see no reason to lose. The queue row is written here too rather
   * than inside — nothing above it needs to be undone if this fails, and the
   * owner keeps the link either way. See ADR-040.
   */
  let emailStatus: PartnerInviteResult['emailStatus'] = null
  if (result.invitation) {
    emailStatus = canComposeEmail() ? 'logged' : 'unconfigured'
    if (canComposeEmail()) {
      const property = await prisma.property.findUnique({
        where: { id: propertyId },
        select: { name: true },
      })
      const locale = input.contactLocale === 'ES' ? ('es' as const) : ('en' as const)
      try {
        const messageId = await queueEmail({
          kind: EmailKind.PARTNER_INVITATION,
          organizationId,
          to: { address: result.contactEmail, name: result.contactName },
          locale,
          rendered: partnerInvitationEmail(locale, {
            partnerName: result.supplierName,
            contactName: result.contactName,
            propertyName: property?.name ?? 'the property',
            inviteUrl: publicUrl(`/invite/${result.invitation.token}`),
            expiresAt: result.invitation.expiresAt,
            commissionPct: (input.hotelCommissionBps / 100).toFixed(
              input.hotelCommissionBps % 100 === 0 ? 0 : 1,
            ),
          }),
          about: { entityType: 'Supplier', entityId: result.supplierId },
          causedByUserId: actor.userId,
        })
        const outcome = await dispatchQueued({ ids: [messageId] })
        /*
         * `deferred` is not `unconfigured`.
         *
         * A message written while `ARC_ENABLE_TRANSACTIONAL_EMAIL` is off, or
         * while the provider was unreachable, stays queued with no attempt
         * consumed — so it goes out when the switch is turned on or the
         * provider recovers. Telling the owner nothing was sent would be true
         * now and wrong in an hour.
         */
        emailStatus = outcome.sent > 0
          ? 'sent'
          : outcome.failed > 0
            ? 'failed'
            : outcome.logged > 0
              ? 'logged'
              : 'queued'
      } catch (error) {
        /*
         * The partner exists and the owner has the link. Failing the whole
         * action because mail failed would report a success as a failure and
         * invite the owner to invite the same partner again, which now
         * conflicts on the email address.
         */
        await reportError(error, {
          where: 'hotels/invitePartner:email',
          extra: { supplierId: result.supplierId },
        })
        emailStatus = 'failed'
      }
    }
  }

  return { supplierId: result.supplierId, invitation: result.invitation, emailStatus }
}

export async function listPartners(actor: ActorContext, propertyId: string) {
  const { organizationId } = await assertPropertyAccess(
    actor, propertyId, Role.OWNER, Role.STAFF, Role.ADMIN,
  )

  return prisma.supplier.findMany({
    where: { organizationId },
    orderBy: [{ verification: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      description: true,
      categories: true,
      status: true,
      insuranceOnFile: true,
      // The three columns a verification standing is derived from, so the
      // owner's list can say "lapsed" rather than "verified" about a
      // certificate that has expired (ADR-036).
      ...VERIFICATION_STANDING_SELECT,
      claimedCertifications: true,
      contactEmail: true,
      contactPhone: true,
      payoutsEnabled: true,
      place: { select: { name: true } },
      agreements: {
        where: { propertyId },
        select: {
          id: true,
          hotelCommissionBps: true,
          platformCommissionBps: true,
          requiresManualConfirmation: true,
          status: true,
          signedAt: true,
        },
      },
      _count: { select: { experiences: true } },
    },
  })
}

/** Arrivals board: who is coming, and what they have (and have not) booked. */
export async function listArrivals(
  actor: ActorContext,
  propertyId: string,
  options: { fromDate: Date; days: number },
) {
  await assertPropertyAccess(actor, propertyId, Role.OWNER, Role.STAFF, Role.ADMIN)

  const to = new Date(options.fromDate.getTime() + options.days * 86_400_000)

  return prisma.stay.findMany({
    where: {
      propertyId,
      // Arrivals are people arriving at the hotel. A direct trip books no room
      // and nobody is coming to the desk for a key (ADR-042).
      kind: StayKind.HOTEL_RESERVATION,
      status: { in: ['BOOKED', 'IN_HOUSE'] },
      /*
       * Arriving in the window, or already in the building.
       *
       * The second half is not a nicety. A guest who checked in last week and
       * booked a lesson this morning fell outside `checkIn >= today` entirely,
       * so there was no operator screen anywhere that listed what they had
       * bought — the hotel could see the money in the briefing and never the
       * booking behind it.
       */
      OR: [
        { checkIn: { gte: options.fromDate, lt: to } },
        { status: StayStatus.IN_HOUSE, checkIn: { lt: options.fromDate } },
      ],
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
      arrivalNotes: true,
      roomType: { select: { name: true, code: true } },
      guest: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          locale: true,
          partySize: true,
          surfAbility: true,
          pace: true,
          interests: true,
          intakeCompletedAt: true,
          mobilityNotes: true,
          dietaryNotes: true,
        },
      },
      orders: {
        where: { status: { in: ['CONFIRMED', 'PENDING'] } },
        select: {
          id: true,
          reference: true,
          totalMinor: true,
          currency: true,
          items: {
            select: {
              id: true,
              quantity: true,
              experience: { select: { titleEn: true, category: true } },
              slot: { select: { startsAt: true } },
            },
          },
        },
      },
    },
  })
}

export { assertOrganizationAccess }

/**
 * Finds a guest from a reference read down the phone.
 *
 * The hotel's screens were all aggregate: the briefing had the money, payouts
 * had the held-back line, and the one place an order reference appeared at all
 * was the *partner's* bookings page. So "my reference is ARC-X3M8-DN7N" had no
 * answer anywhere on the operator side.
 *
 * Both references resolve here because the desk cannot be expected to know
 * which one a guest is holding: `ARC-…` is an order, `STAY-…` is the stay, and
 * a guest reads out whichever is in front of them.
 *
 * Scoped by `propertyId` in the `where` clause rather than checked afterwards
 * — the guest-surface rule in `CLAUDE.md` applies just as well to an operator
 * typing a reference they were given over the phone.
 */
export async function lookupReference(
  actor: ActorContext,
  propertyId: string,
  raw: unknown,
): Promise<{
  reference: string
  stays: Array<{
    id: string
    reference: string
    kind: StayKind
    status: StayStatus
    checkIn: Date
    checkOut: Date
    portalToken: string
    guest: { firstName: string; lastName: string } | null
    orders: Array<{
      id: string
      reference: string
      status: string
      totalMinor: number
      currency: string
      items: Array<{
        id: string
        quantity: number
        supplierConfirmedAt: Date | null
        cancelledAt: Date | null
        experience: { titleEn: string; supplier: { name: string } }
        slot: { startsAt: Date }
      }>
    }>
  }>
}> {
  await assertPropertyAccess(actor, propertyId, Role.OWNER, Role.STAFF, Role.ADMIN)

  const { reference } = referenceLookupSchema.parse(raw)

  const orderSelect = {
    id: true,
    reference: true,
    status: true,
    totalMinor: true,
    currency: true,
    items: {
      select: {
        id: true,
        quantity: true,
        supplierConfirmedAt: true,
        cancelledAt: true,
        // Through the experience: `OrderItem.supplierId` is a scalar, and the
        // experience is where the relation lives.
        experience: { select: { titleEn: true, supplier: { select: { name: true } } } },
        slot: { select: { startsAt: true } },
      },
      orderBy: { id: 'asc' },
    },
  } as const

  const stays = await prisma.stay.findMany({
    where: {
      propertyId,
      OR: [{ reference }, { orders: { some: { reference } } }],
    },
    orderBy: { checkIn: 'desc' },
    select: {
      id: true,
      reference: true,
      kind: true,
      status: true,
      checkIn: true,
      checkOut: true,
      portalToken: true,
      guest: { select: { firstName: true, lastName: true } },
      /*
       * A stay found by its own reference shows everything on it; a stay found
       * by an order reference shows that order, because that is the one the
       * guest is asking about.
       */
      orders: {
        where: reference.startsWith('STAY-') ? {} : { reference },
        orderBy: { createdAt: 'desc' },
        select: orderSelect,
      },
    },
  })

  return { reference, stays }
}
