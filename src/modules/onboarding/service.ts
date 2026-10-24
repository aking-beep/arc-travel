import { prisma } from '@/lib/db'
import { conflict } from '@/lib/errors'
import { hashPassword } from '@/lib/password'
import { assertWithinRateLimit, rateLimitSubject } from '@/lib/rate-limit'
import { uniqueSlug } from '@/lib/slug'
import { EntityStatus, Role, VerificationStatus } from '@/lib/prisma-types'
import { recordAudit } from '@/modules/workflows/audit'
import { organizationSignUpSchema } from '@/modules/auth/schemas'
import type { ActorContext } from '@/modules/tenancy/context'

/**
 * Hotel sign-up.
 *
 * Until this existed, nothing in the product created an `Organization` or a
 * `Property` — only `prisma/seed.ts` did, which meant step one of the
 * commercial journey was "ask an engineer to seed you". Everything downstream
 * (the catalog, partners, the portal) was reachable only for a tenant the seed
 * had written.
 *
 * Four things are created together or not at all: the person's `User`, the
 * `Organization`, its first `Property`, and the `OWNER` `Membership` that ties
 * them. A partial tenant is worse than no tenant — an organization with no
 * owner is unreachable and has to be cleaned up by hand.
 *
 * What it deliberately does *not* do:
 *
 *   * Mark anything VERIFIED. `/admin` remains the only route to a verified
 *     status (CLAUDE.md, non-negotiable 2), so a new property starts
 *     `DRAFT` / `UNVERIFIED` and says so on its own dashboard.
 *   * Grant platform authority. `isPlatformAdmin` is never set here.
 *   * Establish a session. The caller signs the new owner in.
 *   * Invent a commercial relationship. No supplier, no agreement, no
 *     commission rule beyond the organization's own default.
 */
export interface RegistrationResult {
  organizationId: string
  propertyId: string
  userId: string
}

/** Signing up is cheap for us and should not be free to automate. */
const SIGN_UPS_PER_CALLER = 5
const SIGN_UP_WINDOW_SECONDS = 3_600

/** Bumped when the terms change, and recorded with each acceptance. */
export const TERMS_VERSION = '2026-10-24'

export async function registerOrganization(
  raw: unknown,
  options: { clientKey?: string | null; now?: Date } = {},
): Promise<RegistrationResult> {
  const input = organizationSignUpSchema.parse(raw)
  const now = options.now ?? new Date()

  if (options.clientKey) {
    await assertWithinRateLimit({
      bucket: `sign-up:caller:${rateLimitSubject(options.clientKey)}`,
      limit: SIGN_UPS_PER_CALLER,
      windowSeconds: SIGN_UP_WINDOW_SECONDS,
      message: 'Too many sign-ups from here. Try again later.',
      now,
    })
  }

  // Checked before the transaction for a readable message, and again by the
  // unique constraint inside it, which is what actually makes it safe.
  const taken = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  })
  if (taken) {
    throw conflict(
      'That email already has an ARC account. Sign in instead, or use a different address.',
    )
  }

  const passwordHash = await hashPassword(input.password)

  const result = await prisma.$transaction(async (tx) => {
    const organizationSlug = await uniqueSlug(
      input.organizationName,
      async (candidate) =>
        Boolean(await tx.organization.findUnique({ where: { slug: candidate }, select: { id: true } })),
      'hotel-group',
    )
    const propertySlug = await uniqueSlug(
      input.propertyName,
      async (candidate) =>
        Boolean(await tx.property.findUnique({ where: { slug: candidate }, select: { id: true } })),
      'property',
    )

    let user
    try {
      user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          phone: input.contactPhone ?? null,
          passwordHash,
        },
        select: { id: true, email: true, name: true },
      })
    } catch (error) {
      // Lost the race to claim the address between the check above and here.
      if ((error as { code?: string }).code === 'P2002') {
        throw conflict('That email already has an ARC account. Sign in instead.')
      }
      throw error
    }

    const organization = await tx.organization.create({
      data: {
        slug: organizationSlug,
        name: input.organizationName,
        legalName: input.legalName ?? null,
        countryCode: input.countryCode,
        // A new tenant is a draft until it has something to sell. Nothing here
        // may present itself as an established business.
        status: EntityStatus.DRAFT,
      },
      select: { id: true, defaultCommissionBps: true },
    })

    const property = await tx.property.create({
      data: {
        organizationId: organization.id,
        slug: propertySlug,
        name: input.propertyName,
        tagline: input.propertyTagline ?? null,
        currency: input.currency,
        contactEmail: input.email,
        contactPhone: input.contactPhone ?? null,
        status: EntityStatus.DRAFT,
        verification: VerificationStatus.UNVERIFIED,
        onboardingStep: 1,
      },
      select: { id: true },
    })

    await tx.membership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        propertyId: property.id,
        role: Role.OWNER,
      },
    })

    const actor: ActorContext = {
      userId: user.id,
      email: user.email,
      name: user.name,
      isPlatformAdmin: false,
      memberships: [
        {
          id: 'pending',
          organizationId: organization.id,
          role: Role.OWNER,
          propertyId: property.id,
          supplierId: null,
        },
      ],
    }

    await recordAudit(
      {
        organizationId: organization.id,
        actor,
        action: 'organization.registered',
        entityType: 'Organization',
        entityId: organization.id,
        metadata: {
          propertyId: property.id,
          countryCode: input.countryCode,
          currency: input.currency,
          // The acceptance itself, not the person's details.
          acceptedTerms: true,
          termsVersion: TERMS_VERSION,
          defaultCommissionBps: organization.defaultCommissionBps,
        },
      },
      tx,
    )

    return { organizationId: organization.id, propertyId: property.id, userId: user.id }
  })

  // No session established here. Signing someone in is the app layer's job —
  // a domain module that set a cookie could not be called from a test, a
  // script or anywhere but a request.
  return result
}

/**
 * What a new tenant still has to do before it can sell anything.
 *
 * Returned as data rather than rendered as prose so the owner dashboard and
 * the tests agree on what "ready" means.
 */
export interface OnboardingStatus {
  propertyId: string
  hasRoomTypes: boolean
  hasPartners: boolean
  hasPublishedExperience: boolean
  hasGuests: boolean
  complete: boolean
}

export async function getOnboardingStatus(propertyId: string): Promise<OnboardingStatus> {
  const [roomTypes, partners, published, guests] = await Promise.all([
    prisma.roomType.count({ where: { propertyId } }),
    prisma.supplierAgreement.count({ where: { propertyId } }),
    prisma.experience.count({ where: { propertyId, status: 'PUBLISHED' } }),
    prisma.guest.count({ where: { propertyId } }),
  ])

  const status: Omit<OnboardingStatus, 'complete'> = {
    propertyId,
    hasRoomTypes: roomTypes > 0,
    hasPartners: partners > 0,
    hasPublishedExperience: published > 0,
    hasGuests: guests > 0,
  }

  return {
    ...status,
    complete:
      status.hasRoomTypes &&
      status.hasPartners &&
      status.hasPublishedExperience &&
      status.hasGuests,
  }
}
