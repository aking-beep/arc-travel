import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { isAppError, type AppError } from '@/lib/errors'
import { EntityStatus, ExperienceStatus, Role, VerificationStatus } from '@/lib/prisma-types'
import {
  acceptJoinRequest,
  createOwnExperience,
  declineJoinRequest,
  getOwnExperienceForEdit,
  listJoinRequests,
  listOpenStorefronts,
  listOwnStorefronts,
  pauseOwnExperience,
  requestToJoinProperty,
  setOwnPrice,
  submitOwnExperienceForReview,
  submitVerificationEvidence,
  updateOwnExperience,
  updateOwnProfile,
} from '@/modules/suppliers/self-service'
import { resetRateLimitCounters } from '@/lib/rate-limit'
import { actorFor, createTenant, markVerified, resetDatabase } from '../helpers/factory'

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await resetDatabase()
  resetRateLimitCounters()
})

function codeOf(error: unknown): string {
  if (!isAppError(error)) throw error
  return (error as AppError).code
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise.catch((e: unknown) => Promise.reject(new Error(codeOf(e))))).rejects.toThrow(
    code,
  )
}

const profileInput = {
  name: 'Escuela Olas Verdes',
  categories: ['SURF'],
  contactEmail: 'hola@olas.example',
}

describe('a partner editing their own profile', () => {
  it('saves what they say about themselves', async () => {
    const t = await createTenant()
    const actor = await actorFor(t.supplierUserId)

    await updateOwnProfile(actor, t.supplierId, {
      ...profileInput,
      description: 'Two instructors, small groups, Zicatela and La Punta.',
      contactPhone: '+52 954 000 0000',
      placeId: t.placeId,
    })

    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: t.supplierId } })
    expect(supplier.name).toBe('Escuela Olas Verdes')
    expect(supplier.description).toContain('La Punta')
    expect(supplier.placeId).toBe(t.placeId)
  })

  it('leaves their verification exactly where it was', async () => {
    const t = await createTenant()
    await markVerified(t.supplierId)
    const before = await prisma.supplier.findUniqueOrThrow({ where: { id: t.supplierId } })

    await updateOwnProfile(await actorFor(t.supplierUserId), t.supplierId, profileInput)

    const after = await prisma.supplier.findUniqueOrThrow({ where: { id: t.supplierId } })
    expect(after.verification).toBe(before.verification)
    expect(after.verifiedChecks).toEqual(before.verifiedChecks)
    expect(after.insuranceOnFile).toBe(before.insuranceOnFile)
    expect(after.insuranceExpiresOn).toEqual(before.insuranceExpiresOn)
    expect(after.payoutsEnabled).toBe(before.payoutsEnabled)
  })

  it('refuses the hotel owner, who may read this but not write it', async () => {
    const t = await createTenant()
    await expectCode(
      updateOwnProfile(await actorFor(t.ownerUserId), t.supplierId, profileInput),
      'FORBIDDEN',
    )
  })

  it('refuses a partner at another hotel entirely', async () => {
    const a = await createTenant()
    const b = await createTenant()
    await expectCode(
      updateOwnProfile(await actorFor(b.supplierUserId), a.supplierId, profileInput),
      'FORBIDDEN',
    )
  })

  it('refuses a place that is not one of the destination’s', async () => {
    const t = await createTenant()
    await expectCode(
      updateOwnProfile(await actorFor(t.supplierUserId), t.supplierId, {
        ...profileInput,
        placeId: '00000000-0000-4000-8000-000000000001',
      }),
      'NOT_FOUND',
    )
  })

  it('records an audit entry, because the hotel’s partner list changed under them', async () => {
    const t = await createTenant()
    await updateOwnProfile(await actorFor(t.supplierUserId), t.supplierId, profileInput)

    const audit = await prisma.auditEvent.findFirst({
      where: { entityType: 'Supplier', entityId: t.supplierId },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit?.action).toMatch(/partner\.profile/)
  })
})

describe('a partner submitting evidence', () => {
  it('asks for a check and gets PENDING, never VERIFIED', async () => {
    const t = await createTenant()
    const outcome = await submitVerificationEvidence(
      await actorFor(t.supplierUserId),
      t.supplierId,
      { claimedCertifications: ['ISA Level 1'] },
    )

    expect(outcome.verification).toBe(VerificationStatus.PENDING)
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: t.supplierId } })
    expect(supplier.verification).toBe(VerificationStatus.PENDING)
    expect(supplier.insuranceOnFile).toBe(false)
    expect(supplier.verifiedChecks).toEqual([])
    expect(supplier.verifiedAt).toBeNull()
  })

  it('stores an insurance claim as a claim and not as cover on file', async () => {
    const t = await createTenant()
    const expires = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10)

    await submitVerificationEvidence(await actorFor(t.supplierUserId), t.supplierId, {
      claimedCertifications: [],
      claimedInsurer: 'Seguros del Pacífico',
      claimedInsurancePolicyRef: 'POL-99',
      claimedInsuranceExpiresOn: expires,
    })

    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: t.supplierId } })
    expect(supplier.claimedInsurer).toBe('Seguros del Pacífico')
    // The claim is recorded; the fact is not. This is the whole of ADR-041.
    expect(supplier.insuranceOnFile).toBe(false)
    expect(supplier.insuranceExpiresOn).toBeNull()
  })

  it('refuses a policy that has already run out', async () => {
    const t = await createTenant()
    const expired = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

    await expectCode(
      submitVerificationEvidence(await actorFor(t.supplierUserId), t.supplierId, {
        claimedCertifications: [],
        claimedInsurer: 'Seguros',
        claimedInsuranceExpiresOn: expired,
      }),
      'VALIDATION_FAILED',
    )
  })

  it('does not un-verify a partner who is already verified mid-season', async () => {
    const t = await createTenant()
    await markVerified(t.supplierId)

    const outcome = await submitVerificationEvidence(
      await actorFor(t.supplierUserId),
      t.supplierId,
      { claimedCertifications: ['New: first aid 2026'] },
    )

    expect(outcome.verification).toBe(VerificationStatus.VERIFIED)
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: t.supplierId } })
    expect(supplier.verification).toBe(VerificationStatus.VERIFIED)
    expect(supplier.claimedCertifications).toContain('New: first aid 2026')
  })

  it('tells the partner what is still outstanding', async () => {
    const t = await createTenant()
    const outcome = await submitVerificationEvidence(
      await actorFor(t.supplierUserId),
      t.supplierId,
      { claimedCertifications: [] },
    )
    expect(outcome.outstanding.length).toBeGreaterThan(0)
  })

  it('refuses the owner', async () => {
    const t = await createTenant()
    await expectCode(
      submitVerificationEvidence(await actorFor(t.ownerUserId), t.supplierId, {
        claimedCertifications: [],
      }),
      'FORBIDDEN',
    )
  })
})

const experienceInput = (t: { propertyId: string; activityId: string }) => ({
  propertyId: t.propertyId,
  activityId: t.activityId,
  titleEn: 'Dawn patrol at La Punta',
  durationMinutes: 150,
  minParty: 1,
  maxParty: 4,
  defaultCapacity: 4,
  cancellationPolicyHours: 24,
  priceMinor: 85_000,
  meetingPoint: 'The palapa at the end of the beach road',
})

describe('a partner drafting their own listing', () => {
  it('creates it as a draft with an active base price', async () => {
    const t = await createTenant()
    const created = await createOwnExperience(
      await actorFor(t.supplierUserId),
      t.supplierId,
      experienceInput(t),
    )

    const experience = await prisma.experience.findUniqueOrThrow({
      where: { id: created.id },
      include: { prices: true },
    })
    expect(experience.status).toBe(ExperienceStatus.DRAFT)
    expect(experience.supplierId).toBe(t.supplierId)
    expect(experience.prices).toHaveLength(1)
    expect(experience.prices[0]?.amountMinor).toBe(85_000)
    expect(experience.prices[0]?.isActive).toBe(true)
  })

  it('prices in the storefront’s currency, not one the partner picked', async () => {
    const t = await createTenant()
    const created = await createOwnExperience(
      await actorFor(t.supplierUserId),
      t.supplierId,
      experienceInput(t),
    )
    const property = await prisma.property.findUniqueOrThrow({ where: { id: t.propertyId } })
    const price = await prisma.price.findFirstOrThrow({ where: { experienceId: created.id } })
    expect(price.currency).toBe(property.currency)
  })

  it('refuses a hotel the partner has no agreement with', async () => {
    const a = await createTenant()
    const b = await createTenant()

    await expectCode(
      createOwnExperience(await actorFor(a.supplierUserId), a.supplierId, {
        ...experienceInput(a),
        propertyId: b.propertyId,
      }),
      'FORBIDDEN',
    )
  })

  it('takes the ability range from the activity rather than from the partner', async () => {
    const t = await createTenant({ activityMinAbility: 'INTERMEDIATE' })
    const created = await createOwnExperience(
      await actorFor(t.supplierUserId),
      t.supplierId,
      experienceInput(t),
    )
    const activity = await prisma.activity.findUniqueOrThrow({ where: { id: t.activityId } })
    const experience = await prisma.experience.findUniqueOrThrow({ where: { id: created.id } })
    expect(experience.minAbility).toBe(activity.minAbility)
  })

  it('gives two listings with the same title different slugs', async () => {
    const t = await createTenant()
    const actor = await actorFor(t.supplierUserId)
    const first = await createOwnExperience(actor, t.supplierId, experienceInput(t))
    const second = await createOwnExperience(actor, t.supplierId, experienceInput(t))
    expect(second.slug).not.toBe(first.slug)
  })

  it('refuses the owner, who has their own catalog form', async () => {
    const t = await createTenant()
    await expectCode(
      createOwnExperience(await actorFor(t.ownerUserId), t.supplierId, experienceInput(t)),
      'FORBIDDEN',
    )
  })
})

/**
 * The same listing without its price.
 *
 * An update carries no price: a price is a `Price` row and `setOwnPrice` is
 * the only thing that writes one. The schema is `.strict()`, so sending one
 * here is refused rather than quietly dropped — which is what it used to be.
 */
function updateInput(t: { propertyId: string; activityId: string }) {
  const { priceMinor: _priceMinor, ...rest } = experienceInput(t)
  return rest
}

describe('a partner editing a listing', () => {
  it('saves a draft', async () => {
    const t = await createTenant()
    const actor = await actorFor(t.supplierUserId)
    const created = await createOwnExperience(actor, t.supplierId, experienceInput(t))

    await updateOwnExperience(actor, t.supplierId, created.id, {
      ...updateInput(t),
      titleEn: 'Dawn patrol, two hours',
    })

    const experience = await prisma.experience.findUniqueOrThrow({ where: { id: created.id } })
    expect(experience.titleEn).toBe('Dawn patrol, two hours')
  })

  it('refuses while the listing is live, because a basket holds what a guest agreed to', async () => {
    const t = await createTenant()
    const actor = await actorFor(t.supplierUserId)
    const created = await createOwnExperience(actor, t.supplierId, experienceInput(t))
    await prisma.experience.update({
      where: { id: created.id },
      data: { status: ExperienceStatus.PUBLISHED },
    })

    await expectCode(
      updateOwnExperience(actor, t.supplierId, created.id, updateInput(t)),
      'CONFLICT',
    )
  })

  it('refuses somebody else’s listing by id', async () => {
    const a = await createTenant()
    const b = await createTenant()

    await expectCode(
      updateOwnExperience(
        await actorFor(b.supplierUserId),
        b.supplierId,
        a.experienceId,
        updateInput(b),
      ),
      'NOT_FOUND',
    )
  })

  it('will not load somebody else’s listing for editing either', async () => {
    const a = await createTenant()
    const b = await createTenant()
    await expectCode(
      getOwnExperienceForEdit(await actorFor(b.supplierUserId), b.supplierId, a.experienceId),
      'NOT_FOUND',
    )
  })
})

describe('a partner changing their price', () => {
  it('writes a new row and deactivates the old one', async () => {
    const t = await createTenant()
    const actor = await actorFor(t.supplierUserId)
    const created = await createOwnExperience(actor, t.supplierId, experienceInput(t))

    await setOwnPrice(actor, t.supplierId, { experienceId: created.id, amountMinor: 99_000 })

    const prices = await prisma.price.findMany({
      where: { experienceId: created.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(prices).toHaveLength(2)
    expect(prices[0]?.isActive).toBe(false)
    expect(prices[0]?.amountMinor).toBe(85_000)
    expect(prices[1]?.isActive).toBe(true)
    expect(prices[1]?.amountMinor).toBe(99_000)
  })

  it('is allowed while the listing is live', async () => {
    const t = await createTenant()
    const actor = await actorFor(t.supplierUserId)
    const created = await createOwnExperience(actor, t.supplierId, experienceInput(t))
    await prisma.experience.update({
      where: { id: created.id },
      data: { status: ExperienceStatus.PUBLISHED },
    })

    await expect(
      setOwnPrice(actor, t.supplierId, { experienceId: created.id, amountMinor: 70_000 }),
    ).resolves.toBeUndefined()
  })

  it('refuses a listing that is not theirs', async () => {
    const a = await createTenant()
    const b = await createTenant()
    await expectCode(
      setOwnPrice(await actorFor(b.supplierUserId), b.supplierId, {
        experienceId: a.experienceId,
        amountMinor: 1,
      }),
      'NOT_FOUND',
    )
  })
})

describe('handing a draft to the hotel', () => {
  it('moves a draft to pending review and never to published', async () => {
    const t = await createTenant()
    const actor = await actorFor(t.supplierUserId)
    const created = await createOwnExperience(actor, t.supplierId, experienceInput(t))

    const outcome = await submitOwnExperienceForReview(actor, t.supplierId, created.id)
    expect(outcome.submitted).toBe(true)

    const experience = await prisma.experience.findUniqueOrThrow({ where: { id: created.id } })
    expect(experience.status).toBe(ExperienceStatus.PENDING_REVIEW)
  })

  it('submits anyway and reports what the hotel will have to fix', async () => {
    const t = await createTenant()
    const actor = await actorFor(t.supplierUserId)
    const created = await createOwnExperience(actor, t.supplierId, experienceInput(t))

    const outcome = await submitOwnExperienceForReview(actor, t.supplierId, created.id)
    // The partner is unverified in this fixture, which is a publish blocker the
    // hotel cannot fix either — so it has to be visible from here.
    expect(outcome.blockers.length + outcome.warnings.length).toBeGreaterThan(0)
  })

  it('refuses a second submission', async () => {
    const t = await createTenant()
    const actor = await actorFor(t.supplierUserId)
    const created = await createOwnExperience(actor, t.supplierId, experienceInput(t))
    await submitOwnExperienceForReview(actor, t.supplierId, created.id)

    await expectCode(submitOwnExperienceForReview(actor, t.supplierId, created.id), 'CONFLICT')
  })

  it('refuses one that is already live', async () => {
    const t = await createTenant()
    const actor = await actorFor(t.supplierUserId)
    await expectCode(
      submitOwnExperienceForReview(actor, t.supplierId, t.experienceId),
      'CONFLICT',
    )
  })
})

describe('a partner pausing a listing', () => {
  it('takes it off sale and leaves the departures alone', async () => {
    const t = await createTenant()
    const actor = await actorFor(t.supplierUserId)

    await pauseOwnExperience(actor, t.supplierId, t.experienceId)

    const experience = await prisma.experience.findUniqueOrThrow({
      where: { id: t.experienceId },
    })
    expect(experience.status).toBe(ExperienceStatus.PAUSED)
    const slot = await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: t.slotId } })
    expect(slot.status).toBe('OPEN')
  })

  it('refuses a draft, where there is nothing to pause', async () => {
    const t = await createTenant()
    const actor = await actorFor(t.supplierUserId)
    const created = await createOwnExperience(actor, t.supplierId, experienceInput(t))
    await expectCode(pauseOwnExperience(actor, t.supplierId, created.id), 'CONFLICT')
  })

  it('cannot be used to pause somebody else’s listing', async () => {
    const a = await createTenant()
    const b = await createTenant()
    await expectCode(
      pauseOwnExperience(await actorFor(b.supplierUserId), b.supplierId, a.experienceId),
      'NOT_FOUND',
    )
  })
})

describe('the storefronts a partner can see', () => {
  it('lists only the hotels they have an agreement with', async () => {
    const a = await createTenant()
    await createTenant()

    const storefronts = await listOwnStorefronts(await actorFor(a.supplierUserId), a.supplierId)
    expect(storefronts.map((s) => s.propertyId)).toEqual([a.propertyId])
  })
})

const joinInput = (slug: string) => ({
  propertySlug: slug,
  businessName: 'Cocina Doña Mar',
  contactName: 'Mar Robles',
  contactEmail: 'mar@example.com',
  categories: ['DINING'],
  pitch: 'A set menu for six, on the roof, three evenings a week.',
})

async function slugOf(propertyId: string): Promise<string> {
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })
  return property.slug
}

describe('a business asking a hotel to take them on', () => {
  it('lists the hotels it may ask, and nothing else about them', async () => {
    const t = await createTenant()
    const open = await listOpenStorefronts()
    const row = open.find((p) => p.slug !== undefined && p.name !== undefined)
    expect(open.map((p) => p.slug)).toContain(await slugOf(t.propertyId))
    expect(Object.keys(row ?? {}).sort()).toEqual(['name', 'placeName', 'slug'])
  })

  it('leaves no hotel out that is active', async () => {
    const t = await createTenant()
    await prisma.property.update({
      where: { id: t.propertyId },
      data: { status: EntityStatus.DRAFT },
    })
    const open = await listOpenStorefronts()
    expect(open.map((p) => p.slug)).not.toContain(await slugOf(t.propertyId))
  })

  it('records the request and creates no relationship whatsoever', async () => {
    const t = await createTenant()
    const suppliersBefore = await prisma.supplier.count()

    const outcome = await requestToJoinProperty(joinInput(await slugOf(t.propertyId)))
    expect(outcome.received).toBe(true)

    const request = await prisma.supplierJoinRequest.findFirstOrThrow({
      where: { propertyId: t.propertyId },
    })
    expect(request.status).toBe('PENDING')
    expect(request.createdSupplierId).toBeNull()
    expect(await prisma.supplier.count()).toBe(suppliersBefore)
    expect(await prisma.user.count({ where: { email: 'mar@example.com' } })).toBe(0)
    expect(await prisma.supplierAgreement.count()).toBe(1) // the fixture's, not a new one
  })

  it('refuses a hotel that is not taking requests', async () => {
    await expectCode(requestToJoinProperty(joinInput('not-a-hotel')), 'NOT_FOUND')
  })

  it('answers a duplicate exactly as it answered the first', async () => {
    const t = await createTenant()
    const slug = await slugOf(t.propertyId)

    const first = await requestToJoinProperty(joinInput(slug))
    const second = await requestToJoinProperty(joinInput(slug))

    expect(second).toEqual(first)
    expect(await prisma.supplierJoinRequest.count({ where: { propertyId: t.propertyId } })).toBe(1)
  })

  it('bounds how many one caller may send', async () => {
    const t = await createTenant()
    const slug = await slugOf(t.propertyId)

    for (let i = 0; i < 5; i += 1) {
      await requestToJoinProperty(
        { ...joinInput(slug), contactEmail: `mar+${String(i)}@example.com` },
        { requesterKey: '198.51.100.7' },
      )
    }

    await expectCode(
      requestToJoinProperty(
        { ...joinInput(slug), contactEmail: 'mar+last@example.com' },
        { requesterKey: '198.51.100.7' },
      ),
      'RATE_LIMITED',
    )
  })
})

describe('the hotel deciding', () => {
  it('shows the owner the requests for their property only', async () => {
    const a = await createTenant()
    const b = await createTenant()
    await requestToJoinProperty(joinInput(await slugOf(a.propertyId)))
    await requestToJoinProperty(joinInput(await slugOf(b.propertyId)))

    const rows = await listJoinRequests(await actorFor(a.ownerUserId), a.propertyId)
    expect(rows).toHaveLength(1)
  })

  it('refuses an owner at another hotel', async () => {
    const a = await createTenant()
    const b = await createTenant()
    await expectCode(listJoinRequests(await actorFor(b.ownerUserId), a.propertyId), 'FORBIDDEN')
  })

  it('creates the partner, the agreement and the login when it accepts', async () => {
    const t = await createTenant()
    await requestToJoinProperty(joinInput(await slugOf(t.propertyId)))
    const request = await prisma.supplierJoinRequest.findFirstOrThrow({
      where: { propertyId: t.propertyId },
    })

    const result = await acceptJoinRequest(await actorFor(t.ownerUserId), t.propertyId, {
      requestId: request.id,
      hotelCommissionBps: 1800,
    })

    const supplier = await prisma.supplier.findUniqueOrThrow({
      where: { id: result.supplierId },
      include: { agreements: true },
    })
    expect(supplier.name).toBe('Cocina Doña Mar')
    // Created by this path, and still unverified with payouts off: accepting a
    // business is a commercial decision, not a verification.
    expect(supplier.verification).toBe(VerificationStatus.UNVERIFIED)
    expect(supplier.payoutsEnabled).toBe(false)
    expect(supplier.agreements[0]?.hotelCommissionBps).toBe(1800)

    const membership = await prisma.membership.findFirstOrThrow({
      where: { supplierId: result.supplierId, role: Role.SUPPLIER },
    })
    expect(membership.organizationId).toBe(t.organizationId)

    const decided = await prisma.supplierJoinRequest.findUniqueOrThrow({
      where: { id: request.id },
    })
    expect(decided.status).toBe('ACCEPTED')
    expect(decided.createdSupplierId).toBe(result.supplierId)
    expect(decided.decidedAt).not.toBeNull()
  })

  it('keeps the business’s own claims as claims on the new partner', async () => {
    const t = await createTenant()
    await requestToJoinProperty({
      ...joinInput(await slugOf(t.propertyId)),
      claimedCertifications: ['Food handling 2026'],
    })
    const request = await prisma.supplierJoinRequest.findFirstOrThrow({
      where: { propertyId: t.propertyId },
    })

    const result = await acceptJoinRequest(await actorFor(t.ownerUserId), t.propertyId, {
      requestId: request.id,
      hotelCommissionBps: 1500,
    })

    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: result.supplierId } })
    expect(supplier.claimedCertifications).toContain('Food handling 2026')
    expect(supplier.insuranceOnFile).toBe(false)
  })

  it('can only be decided once', async () => {
    const t = await createTenant()
    await requestToJoinProperty(joinInput(await slugOf(t.propertyId)))
    const request = await prisma.supplierJoinRequest.findFirstOrThrow({
      where: { propertyId: t.propertyId },
    })
    const owner = await actorFor(t.ownerUserId)

    await acceptJoinRequest(owner, t.propertyId, {
      requestId: request.id,
      hotelCommissionBps: 1500,
    })

    await expectCode(
      declineJoinRequest(owner, t.propertyId, { requestId: request.id }),
      'NOT_FOUND',
    )
  })

  it('declines without sending the business anything', async () => {
    const t = await createTenant()
    await requestToJoinProperty(joinInput(await slugOf(t.propertyId)))
    const request = await prisma.supplierJoinRequest.findFirstOrThrow({
      where: { propertyId: t.propertyId },
    })

    await declineJoinRequest(await actorFor(t.ownerUserId), t.propertyId, {
      requestId: request.id,
      decisionNote: 'Already have a kitchen partner.',
    })

    const decided = await prisma.supplierJoinRequest.findUniqueOrThrow({
      where: { id: request.id },
    })
    expect(decided.status).toBe('DECLINED')
    expect(decided.decisionNote).toContain('kitchen partner')
    expect(await prisma.emailMessage.count({ where: { toAddress: 'mar@example.com' } })).toBe(0)
  })

  it('refuses an owner at another hotel deciding on this one’s request', async () => {
    const a = await createTenant()
    const b = await createTenant()
    await requestToJoinProperty(joinInput(await slugOf(a.propertyId)))
    const request = await prisma.supplierJoinRequest.findFirstOrThrow({
      where: { propertyId: a.propertyId },
    })

    await expectCode(
      acceptJoinRequest(await actorFor(b.ownerUserId), b.propertyId, {
        requestId: request.id,
        hotelCommissionBps: 1500,
      }),
      'NOT_FOUND',
    )
  })

  it('refuses the partner themselves, who is not the hotel', async () => {
    const t = await createTenant()
    await requestToJoinProperty(joinInput(await slugOf(t.propertyId)))
    const request = await prisma.supplierJoinRequest.findFirstOrThrow({
      where: { propertyId: t.propertyId },
    })

    await expectCode(
      acceptJoinRequest(await actorFor(t.supplierUserId), t.propertyId, {
        requestId: request.id,
        hotelCommissionBps: 1500,
      }),
      'FORBIDDEN',
    )
  })
})
