import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { isAppError } from '@/lib/errors'
import {
  EntityStatus,
  ExperienceCategory,
  ExperienceStatus,
  VerificationStatus,
} from '@/lib/prisma-types'
import {
  getDestinationOverview,
  getPublicExperience,
  getPublicProperty,
  listPublicExperiences,
  listPublicPlaces,
} from '@/modules/discovery/service'
import { createTenant, resetDatabase, type TenantFixture } from '../helpers/factory'

/**
 * The public read model.
 *
 * Every other read service in this codebase starts from a tenancy context. This
 * one cannot, because a visitor is nobody, so the only authorisation question it
 * has is *publication*: a row reaches the public surface because somebody
 * published it, not because of who is asking. These tests are the proof of that
 * — and the proof that nothing else leaks through with it.
 *
 * Two organizations exist in each case for the same reason they do in the
 * tenancy suite: so the cross-tenant behaviour is asserted rather than assumed.
 * Here, unlike there, both organizations' published rows are *expected* to
 * appear. A public catalogue that showed only one hotel's experiences would be
 * a different product.
 */
let alpha: TenantFixture
let beta: TenantFixture

beforeEach(async () => {
  await resetDatabase()
  alpha = await createTenant({ name: 'alpha', priceMinor: 95_000 })
  beta = await createTenant({ name: 'beta', priceMinor: 240_000 })
})

afterAll(async () => {
  await prisma.$disconnect()
})

const notFound = (error: unknown) => isAppError(error) && error.code === 'NOT_FOUND'

const slugOf = async (experienceId: string) =>
  (await prisma.experience.findUniqueOrThrow({ where: { id: experienceId } })).slug

describe('listPublicExperiences', () => {
  it('returns published experiences from every organization', async () => {
    const { items } = await listPublicExperiences()
    const slugs = items.map((i) => i.slug)
    expect(slugs).toContain(await slugOf(alpha.experienceId))
    expect(slugs).toContain(await slugOf(beta.experienceId))
  })

  it('hides anything not published', async () => {
    for (const status of [ExperienceStatus.DRAFT, ExperienceStatus.ARCHIVED]) {
      await prisma.experience.update({ where: { id: beta.experienceId }, data: { status } })
      const { items } = await listPublicExperiences()
      expect(items.map((i) => i.slug)).not.toContain(await slugOf(beta.experienceId))
    }
  })

  it('hides a published experience whose status says published but was never published', async () => {
    // Both halves of the predicate matter: `publishedAt` is what a page would
    // show as the date, and a row with a PUBLISHED status and no timestamp is a
    // row no admin ever acted on.
    await prisma.experience.update({
      where: { id: beta.experienceId },
      data: { status: ExperienceStatus.PUBLISHED, publishedAt: null },
    })
    const { items } = await listPublicExperiences()
    expect(items.map((i) => i.slug)).not.toContain(await slugOf(beta.experienceId))
  })

  it('hides an experience whose property is no longer active', async () => {
    await prisma.property.update({
      where: { id: beta.propertyId },
      data: { status: EntityStatus.SUSPENDED },
    })
    const { items } = await listPublicExperiences()
    expect(items.map((i) => i.slug)).not.toContain(await slugOf(beta.experienceId))
    expect(items.map((i) => i.slug)).toContain(await slugOf(alpha.experienceId))
  })

  it('filters by category, and drops a filter it cannot parse rather than throwing', async () => {
    await prisma.experience.update({
      where: { id: beta.experienceId },
      data: { category: ExperienceCategory.CULTURE },
    })

    const surf = await listPublicExperiences({ category: 'SURF' })
    expect(surf.items.map((i) => i.slug)).toEqual([await slugOf(alpha.experienceId)])

    // A hand-typed query string is not a form; a bad value means "no filter".
    const nonsense = await listPublicExperiences({ category: 'NOT_A_CATEGORY' })
    expect(nonsense.filter.category).toBeUndefined()
    expect(nonsense.items).toHaveLength(2)
  })

  it('applies a price ceiling, and excludes an experience with no active price', async () => {
    const cheap = await listPublicExperiences({ maxPriceMinor: '100000' })
    expect(cheap.items.map((i) => i.slug)).toEqual([await slugOf(alpha.experienceId)])

    // No price is not "free": an experience with nothing to be judged against
    // must not slip under a ceiling.
    await prisma.price.updateMany({
      where: { experienceId: alpha.experienceId },
      data: { isActive: false },
    })
    const unpriced = await listPublicExperiences({ maxPriceMinor: '100000' })
    expect(unpriced.items).toHaveLength(0)
    // Unfiltered, it is still in the catalogue — just without a figure.
    const all = await listPublicExperiences()
    const alphaSlug = await slugOf(alpha.experienceId)
    expect(all.items.map((i) => i.slug)).toContain(alphaSlug)
    expect(all.items.find((i) => i.slug === alphaSlug)?.prices).toHaveLength(0)
  })

  it('reports the categories present before filtering', async () => {
    await prisma.experience.update({
      where: { id: beta.experienceId },
      data: { category: ExperienceCategory.CULTURE },
    })
    const result = await listPublicExperiences({ category: 'SURF' })
    expect(result.categories).toEqual([ExperienceCategory.CULTURE, ExperienceCategory.SURF])
    // `rows` is already category-filtered; only the price ceiling is applied
    // after the query, so this counts one.
    expect(result.totalBeforePriceFilter).toBe(1)
  })
})

describe('getPublicExperience', () => {
  it('returns a published experience by slug', async () => {
    const slug = await slugOf(alpha.experienceId)
    const experience = await getPublicExperience(slug)
    expect(experience.slug).toBe(slug)
  })

  it('is notFound for an unpublished slug, not forbidden', async () => {
    // A public route must not disclose that a draft exists at this slug.
    const slug = await slugOf(alpha.experienceId)
    await prisma.experience.update({
      where: { id: alpha.experienceId },
      data: { status: ExperienceStatus.DRAFT },
    })
    await expect(getPublicExperience(slug)).rejects.toSatisfy(notFound)
    await expect(getPublicExperience('no-such-experience')).rejects.toSatisfy(notFound)
  })

  it('passes the supplier through unverified', async () => {
    // CLAUDE.md non-negotiable 2: /admin is the only route to VERIFIED, and a
    // fixture supplier must reach the page as the claim it is.
    const experience = await getPublicExperience(await slugOf(alpha.experienceId))
    expect(experience.supplier.verification).toBe(VerificationStatus.UNVERIFIED)
  })
})

describe('getPublicProperty', () => {
  it('returns the active property with its published rate range', async () => {
    await prisma.roomType.createMany({
      data: [
        {
          propertyId: alpha.propertyId,
          organizationId: alpha.organizationId,
          code: 'GDN',
          name: 'Garden room',
          maxOccupancy: 2,
          roomCount: 4,
          baseRateMinor: 240_000,
          currency: 'MXN',
        },
        {
          propertyId: alpha.propertyId,
          organizationId: alpha.organizationId,
          code: 'STE',
          name: 'Suite',
          maxOccupancy: 4,
          roomCount: 1,
          baseRateMinor: 780_000,
          currency: 'MXN',
        },
      ],
    })

    const property = await getPublicProperty()
    expect(property.id).toBe(alpha.propertyId)
    expect(property.rateRange?.min.amountMinor).toBe(240_000)
    expect(property.rateRange?.max.amountMinor).toBe(780_000)
  })

  it('has a null rate range rather than a zero one when nothing is priced', async () => {
    const property = await getPublicProperty()
    expect(property.rateRange).toBeNull()
  })

  it('is notFound when no property is active', async () => {
    await prisma.property.updateMany({ data: { status: EntityStatus.ARCHIVED } })
    await expect(getPublicProperty()).rejects.toSatisfy(notFound)
  })
})

describe('listPublicPlaces', () => {
  it('returns the destination graph with its provenance attached', async () => {
    const places = await listPublicPlaces()
    expect(places.length).toBeGreaterThan(0)
    for (const place of places) {
      expect(place.provenance).toBeTruthy()
      expect(place).toHaveProperty('factsUpdatedAt')
      // A place is a fact about a coastline. It never carries a verdict.
      expect(place).not.toHaveProperty('safe')
      expect(place).not.toHaveProperty('allowed')
    }
  })

  it('is scoped to the destination the build covers', async () => {
    await prisma.place.update({
      where: { id: beta.placeId },
      data: { destination: 'somewhere-else' },
    })
    const places = await listPublicPlaces()
    expect(places.map((p) => p.id)).not.toContain(beta.placeId)
    expect(places.map((p) => p.id)).toContain(alpha.placeId)
  })
})

describe('getDestinationOverview', () => {
  it('reports that the whole catalogue is unverified while it is', async () => {
    const overview = await getDestinationOverview()
    expect(overview.allUnverified).toBe(true)
    expect(overview.featuredExperiences.length).toBeLessThanOrEqual(6)
    expect(overview.experienceCount).toBe(2)
  })

  it('stops saying so the moment one supplier is verified', async () => {
    await prisma.supplier.update({
      where: { id: alpha.supplierId },
      data: { verification: VerificationStatus.VERIFIED },
    })
    const overview = await getDestinationOverview()
    expect(overview.allUnverified).toBe(false)
  })

  it('carries conditions with their timestamps and no safety verdict', async () => {
    const overview = await getDestinationOverview()
    const serialised = JSON.stringify(overview.conditions)
    expect(serialised).not.toMatch(/"safe"/)
  })
})
