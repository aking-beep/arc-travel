import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { isAppError } from '@/lib/errors'
import { CommissionBasis, ExperienceCategory } from '@/lib/prisma-types'
import {
  getCommissionOverview,
  setCommissionRuleActive,
  updateCommissionDefaults,
  upsertCommissionRule,
} from '@/modules/commerce/commission-admin'
import { actorFor, createTenant, resetDatabase, type TenantFixture } from '../helpers/factory'

/**
 * Commission administration.
 *
 * `resolveCommission` could always answer "who gets what", but no route let an
 * owner see or change a rule — so the split they had agreed with a partner
 * could only be altered by an engineer. These tests pin the two properties that
 * matter commercially: the preview comes from the same resolver the checkout
 * uses, and a rule is scoped to the organization that wrote it.
 */
let tenant: TenantFixture

beforeEach(async () => {
  await resetDatabase()
  tenant = await createTenant({})
})
afterAll(() => prisma.$disconnect())

describe('getCommissionOverview', () => {
  it('previews a split for every published experience from the live resolver', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const overview = await getCommissionOverview(actor, tenant.propertyId)

    expect(overview.preview.length).toBeGreaterThan(0)
    for (const row of overview.preview) {
      // The three shares always re-sum to gross; the partner takes the
      // remainder, including every rounding centavo.
      expect(row.hotelMinor + row.platformMinor + row.supplierMinor).toBe(row.unitPriceMinor)
    }
  })

  it('reports both halves of the organization default', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const overview = await getCommissionOverview(actor, tenant.propertyId)
    expect(overview.defaults.hotelBps).toBeGreaterThan(0)
    // Zero here was the hole: a tenant with no rule earned ARC nothing.
    expect(overview.defaults.platformBps).toBeGreaterThan(0)
  })

  it('refuses an actor from another tenant', async () => {
    const other = await createTenant({})
    const outsider = await actorFor(other.ownerUserId)
    await expect(getCommissionOverview(outsider, tenant.propertyId)).rejects.toThrow()
  })
})

describe('upsertCommissionRule', () => {
  it('changes what a sale would split, through the same resolver', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const before = await getCommissionOverview(actor, tenant.propertyId)
    const target = before.preview[0]!

    await upsertCommissionRule(actor, tenant.propertyId, {
      propertyId: tenant.propertyId,
      experienceId: target.experienceId,
      basis: CommissionBasis.PERCENT_OF_GROSS,
      hotelShare: 2_500,
      platformShare: 700,
      priority: 10,
      note: 'Negotiated for the surf school',
      isActive: true,
    })

    const after = await getCommissionOverview(actor, tenant.propertyId)
    const row = after.preview.find((r) => r.experienceId === target.experienceId)!
    expect(row.resolved.specificity).toBe('experience')
    expect(row.resolved.hotelShare).toBe(2_500)
    expect(row.hotelMinor + row.platformMinor + row.supplierMinor).toBe(row.unitPriceMinor)
  })

  it('refuses shares that add up to more than the gross', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    await expect(
      upsertCommissionRule(actor, tenant.propertyId, {
        basis: CommissionBasis.PERCENT_OF_GROSS,
        hotelShare: 7_000,
        platformShare: 4_000,
        category: ExperienceCategory.SURF,
      }),
    ).rejects.toThrow()
  })

  it('refuses an experience from another property', async () => {
    const other = await createTenant({})
    const actor = await actorFor(tenant.ownerUserId)

    const error = await upsertCommissionRule(actor, tenant.propertyId, {
      propertyId: tenant.propertyId,
      experienceId: other.experienceId,
      basis: CommissionBasis.PERCENT_OF_GROSS,
      hotelShare: 1_000,
      platformShare: 500,
    }).catch((e: unknown) => e)
    expect(isAppError(error) && error.code).toBe('NOT_FOUND')
  })

  it('refuses to update a rule belonging to another organization', async () => {
    const other = await createTenant({})
    const otherActor = await actorFor(other.ownerUserId)
    const theirs = await upsertCommissionRule(otherActor, other.propertyId, {
      propertyId: other.propertyId,
      basis: CommissionBasis.PERCENT_OF_GROSS,
      hotelShare: 1_000,
      platformShare: 500,
    })

    const actor = await actorFor(tenant.ownerUserId)
    await expect(
      upsertCommissionRule(actor, tenant.propertyId, {
        id: theirs.id,
        basis: CommissionBasis.PERCENT_OF_GROSS,
        hotelShare: 9_000,
        platformShare: 0,
      }),
    ).rejects.toThrow()

    const unchanged = await prisma.commissionRule.findUniqueOrThrow({
      where: { id: theirs.id },
      select: { hotelShare: true },
    })
    expect(unchanged.hotelShare).toBe(1_000)
  })

  it('records the change', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const rule = await upsertCommissionRule(actor, tenant.propertyId, {
      propertyId: tenant.propertyId,
      basis: CommissionBasis.PERCENT_OF_GROSS,
      hotelShare: 1_800,
      platformShare: 500,
    })

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'commission.rule.created', entityId: rule.id },
      select: { metadataJson: true },
    })
    expect(event.metadataJson).toMatchObject({ hotelShare: 1_800, platformShare: 500 })
  })
})

describe('setCommissionRuleActive', () => {
  it('deactivates rather than deletes, and resolution falls back', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const before = await getCommissionOverview(actor, tenant.propertyId)
    const target = before.preview[0]!

    const rule = await upsertCommissionRule(actor, tenant.propertyId, {
      propertyId: tenant.propertyId,
      experienceId: target.experienceId,
      basis: CommissionBasis.PERCENT_OF_GROSS,
      hotelShare: 3_000,
      platformShare: 500,
    })

    await setCommissionRuleActive(actor, rule.id, false)

    // The row survives, because a past order's ledger names it.
    expect(
      await prisma.commissionRule.findUnique({ where: { id: rule.id }, select: { id: true } }),
    ).not.toBeNull()

    const after = await getCommissionOverview(actor, tenant.propertyId)
    const row = after.preview.find((r) => r.experienceId === target.experienceId)!
    expect(row.resolved.ruleId).not.toBe(rule.id)
  })

  it('refuses an actor from another organization', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const rule = await upsertCommissionRule(actor, tenant.propertyId, {
      propertyId: tenant.propertyId,
      basis: CommissionBasis.PERCENT_OF_GROSS,
      hotelShare: 1_500,
      platformShare: 500,
    })

    const other = await createTenant({})
    const outsider = await actorFor(other.ownerUserId)
    await expect(setCommissionRuleActive(outsider, rule.id, false)).rejects.toThrow()
  })
})

describe('updateCommissionDefaults', () => {
  it('changes the fallback both halves come from', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    await updateCommissionDefaults(actor, tenant.organizationId, {
      hotelBps: 2_000,
      platformBps: 300,
    })

    const overview = await getCommissionOverview(actor, tenant.propertyId)
    expect(overview.defaults).toEqual({ hotelBps: 2_000, platformBps: 300 })
  })

  it('refuses a split over 100% of gross', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    await expect(
      updateCommissionDefaults(actor, tenant.organizationId, {
        hotelBps: 8_000,
        platformBps: 3_000,
      }),
    ).rejects.toThrow()
  })

  it('refuses an actor from another organization', async () => {
    const other = await createTenant({})
    const outsider = await actorFor(other.ownerUserId)
    await expect(
      updateCommissionDefaults(outsider, tenant.organizationId, {
        hotelBps: 100,
        platformBps: 0,
      }),
    ).rejects.toThrow()
  })
})
