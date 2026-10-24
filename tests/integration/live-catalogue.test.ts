import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { ExperienceStatus, VerificationStatus } from '@/lib/prisma-types'
import { liveExperience, liveExperiences, liveStay } from '@/modules/discovery/live'
import { createTenant, resetDatabase, type TenantFixture } from '../helpers/factory'

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

    await prisma.supplier.update({
      where: { id: tenant.supplierId },
      data: { verification: VerificationStatus.VERIFIED },
    })
    const [verified] = await liveExperiences('en')
    expect(verified?.provenance).toEqual({
      kind: 'live',
      verification: VerificationStatus.VERIFIED,
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
})
