import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { ExperienceStatus, VerificationStatus } from '@/lib/prisma-types'
import { liveExperience, liveExperiences, liveStay } from '@/modules/discovery/live'
import { createTenant, markVerified, resetDatabase, type TenantFixture } from '../helpers/factory'

let tenant: TenantFixture

/**
 * The bridge from the published catalogue to the public surface.
 *
 * `modules/discovery/service.ts` was a tested read model that no route
 * rendered — the public surface ran entirely on the illustrative content set,
 * so the one destination this build has real data for was showing fixtures.
 * These assert the mapping, and above all the five things it refuses to do.
 */
beforeEach(async () => {
  await resetDatabase()
  tenant = await createTenant({ capacity: 6, priceMinor: 95_000 })
  // `createTenant` builds a draft catalogue; the public surface only ever sees
  // a published one, which is the point of the predicate it queries through.
  await prisma.experience.update({
    where: { id: tenant.experienceId },
    data: { status: ExperienceStatus.PUBLISHED, publishedAt: new Date() },
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('liveExperiences', () => {
  it('maps a published experience with its own currency, not the content set’s', async () => {
    const [item, ...rest] = await liveExperiences('en')
    expect(rest).toHaveLength(0)
    expect(item).toBeDefined()

    expect(item?.priceMinor).toBe(95_000)
    // The content set is USD. Rendering pesos under a dollar sign would be a
    // lie about a price, so the currency travels with the amount.
    expect(item?.currency).toBe('MXN')
    expect(item?.destination).toBe('puerto-escondido')
  })

  it('invents nothing to fill a field', async () => {
    const [item] = await liveExperiences('en')

    // The database holds no photograph, no host biography, no years of
    // experience and no step-by-step breakdown. Each is absent rather than
    // plausible.
    expect(item?.image).toBeUndefined()
    expect(item?.host.years).toBeUndefined()
    expect(item?.host.role).toBeUndefined()
    expect(item?.itinerary).toEqual([])
    // And no rating: a rating nobody left is not a signal to manufacture.
    expect(item).not.toHaveProperty('rating')
  })

  it('carries the row’s real verification status, so only /admin can change it', async () => {
    const [unverified] = await liveExperiences('en')
    expect(unverified?.provenance).toEqual({
      kind: 'live',
      verification: VerificationStatus.UNVERIFIED,
    })

    await markVerified(tenant.supplierId)
    const [verified] = await liveExperiences('en')
    expect(verified?.provenance).toEqual({
      kind: 'live',
      verification: VerificationStatus.VERIFIED,
    })
  })

  /*
   * ADR-036's second amendment. The badge on a public card is a guest-facing
   * verification claim, and this module read `supplier.verification` — so the
   * one surface a stranger sees was the one surface that would have gone on
   * printing a badge after it stopped being true. Both halves of a lapse are
   * asserted here, because the amendment covers both.
   */
  it('stops claiming verified when the insurance certificate has expired', async () => {
    await markVerified(tenant.supplierId, {
      insuranceExpiresOn: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    })

    const [item] = await liveExperiences('en')
    // Still listed: a lapse changes presentation, not data, and nothing is
    // unpublished over it (non-negotiable 6).
    expect(item).toBeDefined()
    expect(item?.provenance).toEqual({
      kind: 'live',
      verification: VerificationStatus.UNVERIFIED,
    })
  })

  /*
   * The other half of a lapse — a `VERIFIED` row whose checklist is empty —
   * cannot be constructed here, and that is the finding rather than a gap:
   * `supplier_insurance_expiry_is_dated` refuses the write. Only pre-ADR rows
   * are in that state, which is why both constraints are `NOT VALID`.
   * `verificationStanding`'s own handling of it is covered in
   * `tests/unit/verification.test.ts`; what matters here is that this module
   * asks the question at all, which the expired certificate above proves.
   */
  it('cannot be put in the incomplete-checklist state by a new write', async () => {
    await markVerified(tenant.supplierId)
    await expect(
      prisma.supplier.update({
        where: { id: tenant.supplierId },
        data: { verifiedChecks: [] },
      }),
    ).rejects.toThrow(/supplier_insurance_expiry_is_dated/)
  })

  it('applies the same rule on the detail page as on the card', async () => {
    await markVerified(tenant.supplierId, {
      insuranceExpiresOn: new Date(Date.now() - 24 * 60 * 60 * 1000),
    })

    const { slug } = await prisma.experience.findUniqueOrThrow({
      where: { id: tenant.experienceId },
      select: { slug: true },
    })
    const detail = await liveExperience(slug, 'en')
    expect(detail?.provenance).toEqual({
      kind: 'live',
      verification: VerificationStatus.UNVERIFIED,
    })
  })

  it('passes the supplier’s claimed certifications through as claims', async () => {
    await prisma.supplier.update({
      where: { id: tenant.supplierId },
      data: { claimedCertifications: ['ISA Level 1', 'First aid (self-reported)'] },
    })

    const [item] = await liveExperiences('en')
    expect(item?.hostClaims).toEqual(['ISA Level 1', 'First aid (self-reported)'])
  })

  it('omits an experience with no active published price', async () => {
    // A public catalogue entry with no price is not something a visitor can
    // act on, and "price on request" from a product that holds the price list
    // is a worse answer than absence.
    await prisma.price.updateMany({
      where: { experienceId: tenant.experienceId },
      data: { isActive: false },
    })
    expect(await liveExperiences('en')).toEqual([])
  })

  it('omits a listing whose supplier was rejected', async () => {
    // The published-catalogue predicate does not exclude one, so the bridge
    // does.
    await prisma.supplier.update({
      where: { id: tenant.supplierId },
      data: { verification: VerificationStatus.REJECTED },
    })
    expect(await liveExperiences('en')).toEqual([])
  })

  it('omits anything not published', async () => {
    await prisma.experience.update({
      where: { id: tenant.experienceId },
      data: { status: ExperienceStatus.DRAFT },
    })
    expect(await liveExperiences('en')).toEqual([])
  })

  it('renders in the viewer’s language where the row has both', async () => {
    await prisma.experience.update({
      where: { id: tenant.experienceId },
      data: { titleEn: 'Dawn surf', titleEs: 'Surf al amanecer' },
    })

    expect((await liveExperiences('en'))[0]?.title).toBe('Dawn surf')
    expect((await liveExperiences('es'))[0]?.title).toBe('Surf al amanecer')
  })

  it('filters in the query rather than over the returned array', async () => {
    const experience = await prisma.experience.findUniqueOrThrow({
      where: { id: tenant.experienceId },
      select: { category: true, titleEn: true },
    })

    expect(await liveExperiences('en', { category: experience.category })).toHaveLength(1)
    expect(await liveExperiences('en', { q: experience.titleEn })).toHaveLength(1)
    expect(await liveExperiences('en', { q: 'nothing matches this' })).toEqual([])
  })

  it('exposes no availability', async () => {
    const [item] = await liveExperiences('en')
    // A published price is a fact about a price list, not an offer on a date.
    // There is deliberately no slot, no hold and no "places left" here.
    for (const key of ['slots', 'availability', 'placesLeft', 'remaining']) {
      expect(item).not.toHaveProperty(key)
    }
  })
})

describe('liveExperience', () => {
  it('returns null rather than throwing for a slug it does not have', async () => {
    // What makes a page able to fall through to the content set instead of
    // rendering a 500.
    expect(await liveExperience('a-slug-from-the-content-set', 'en')).toBeNull()
  })

  it('adds the detail fields the card does not carry', async () => {
    await prisma.experience.update({
      where: { id: tenant.experienceId },
      data: {
        descriptionEn: 'First paragraph.\n\nSecond paragraph.',
        meetingPoint: 'The palapa at the south end',
        whatToBringEn: 'Rash vest',
      },
    })
    await prisma.supplier.update({
      where: { id: tenant.supplierId },
      data: { description: 'Running lessons here since the break was empty.' },
    })

    const slug = (await prisma.experience.findUniqueOrThrow({
      where: { id: tenant.experienceId },
      select: { slug: true },
    })).slug

    const item = await liveExperience(slug, 'en')
    expect(item?.description).toEqual(['First paragraph.', 'Second paragraph.'])
    expect(item?.meetingPoint).toBe('The palapa at the south end')
    expect(item?.included).toContain('Bring: Rash vest')
    expect(item?.host.bio).toBe('Running lessons here since the break was empty.')
    // Still no invented role or tenure, even on the detail view.
    expect(item?.host.role).toBeUndefined()
    expect(item?.host.years).toBeUndefined()
  })
})

describe('liveStay', () => {
  it('reads the real property, its rooms and its own currency', async () => {
    await prisma.roomType.create({
      data: {
        organizationId: tenant.organizationId,
        propertyId: tenant.propertyId,
        code: 'GARDEN',
        name: 'Garden room',
        maxOccupancy: 2,
        roomCount: 4,
        baseRateMinor: 280_000,
        currency: 'MXN',
      },
    })

    const stay = await liveStay('en')
    expect(stay?.pricePerNightMinor).toBe(280_000)
    expect(stay?.currency).toBe('MXN')
    expect(stay?.rooms).toHaveLength(1)
    expect(stay?.rooms[0]?.sleeps).toBe(2)
    // No room size: the schema has none, and a square-metre figure is a claim
    // about a building.
    expect(stay?.rooms[0]?.size).toBe('—')
    expect(stay?.images).toEqual([])
    expect(stay?.rating).toBeUndefined()
    expect(stay?.provenance).toMatchObject({ kind: 'live' })
  })

  it('returns null when no room type carries a rate', async () => {
    // A stay with no nightly rate has nothing to show on a card.
    expect(await liveStay('en')).toBeNull()
  })

  /*
   * The seed used to write `VERIFIED` on the demo property, and this column is
   * what the public card's badge reads — so the home page printed a shield and
   * "Verified by ARC" beside the hotel to any stranger, with no verification
   * record anywhere behind it, while `/admin` said "Nothing is verified by a
   * seed" on the same build. A property has no checklist and no insurance
   * expiry, so there is no standing to derive: the column is the decision, and
   * what this asserts is that an unverified property claims nothing.
   */
  it('claims nothing for a property no admin has verified', async () => {
    await prisma.roomType.create({
      data: {
        organizationId: tenant.organizationId,
        propertyId: tenant.propertyId,
        code: 'GARDEN',
        name: 'Garden room',
        maxOccupancy: 2,
        roomCount: 4,
        baseRateMinor: 280_000,
        currency: 'MXN',
      },
    })

    const property = await prisma.property.findUniqueOrThrow({
      where: { id: tenant.propertyId },
      select: { verification: true },
    })
    expect(property.verification).not.toBe(VerificationStatus.VERIFIED)

    const stay = await liveStay('en')
    expect(stay?.provenance).toEqual({
      kind: 'live',
      verification: VerificationStatus.UNVERIFIED,
    })
  })
})
