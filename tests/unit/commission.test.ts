import { describe, expect, it } from 'vitest'
import { money } from '@/lib/money'
import { CommissionBasis, ExperienceCategory } from '@/lib/prisma-types'
import {
  potentialHotelEarnings,
  resolveCommission,
  splitEarnings,
  type CommissionRuleInput,
} from '@/modules/commerce/commission'

const PROPERTY = 'property-1'
const EXPERIENCE = 'experience-1'

function rule(partial: Partial<CommissionRuleInput>): CommissionRuleInput {
  return {
    id: 'rule',
    propertyId: null,
    experienceId: null,
    category: null,
    basis: CommissionBasis.PERCENT_OF_GROSS,
    hotelShare: 1500,
    platformShare: 500,
    priority: 0,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...partial,
  }
}

const target = {
  propertyId: PROPERTY,
  experienceId: EXPERIENCE,
  category: ExperienceCategory.SURF,
}

describe('resolveCommission', () => {
  it('falls back to the organization default when nothing matches', () => {
    const resolved = resolveCommission([], target, 1800)
    expect(resolved.specificity).toBe('organization-default')
    expect(resolved.hotelShare).toBe(1800)
    expect(resolved.platformShare).toBe(0)
    expect(resolved.ruleId).toBeNull()
  })

  it('prefers the most specific rule: experience over category over property', () => {
    const rules = [
      rule({ id: 'property', propertyId: PROPERTY, hotelShare: 1000 }),
      rule({ id: 'category', propertyId: PROPERTY, category: ExperienceCategory.SURF, hotelShare: 2000 }),
      rule({ id: 'experience', propertyId: PROPERTY, experienceId: EXPERIENCE, hotelShare: 3000 }),
    ]
    expect(resolveCommission(rules, target, 1500).ruleId).toBe('experience')

    const withoutExperience = rules.filter((r) => r.id !== 'experience')
    expect(resolveCommission(withoutExperience, target, 1500).ruleId).toBe('category')

    const propertyOnly = rules.filter((r) => r.id === 'property')
    expect(resolveCommission(propertyOnly, target, 1500).ruleId).toBe('property')
  })

  it('ignores rules for another property, experience or category', () => {
    const rules = [
      rule({ id: 'other-property', propertyId: 'property-2', hotelShare: 9000 }),
      rule({ id: 'other-experience', propertyId: PROPERTY, experienceId: 'experience-2', hotelShare: 9000 }),
      rule({ id: 'other-category', propertyId: PROPERTY, category: ExperienceCategory.DINING, hotelShare: 9000 }),
    ]
    expect(resolveCommission(rules, target, 1500).specificity).toBe('organization-default')
  })

  it('ignores inactive rules', () => {
    const rules = [rule({ id: 'inactive', propertyId: PROPERTY, isActive: false, hotelShare: 9000 })]
    expect(resolveCommission(rules, target, 1500).hotelShare).toBe(1500)
  })

  it('breaks ties on priority, then on the newest rule', () => {
    const rules = [
      rule({ id: 'low', propertyId: PROPERTY, priority: 1, hotelShare: 1000 }),
      rule({ id: 'high', propertyId: PROPERTY, priority: 9, hotelShare: 2000 }),
    ]
    expect(resolveCommission(rules, target, 1500).ruleId).toBe('high')

    const samePriority = [
      rule({ id: 'older', propertyId: PROPERTY, createdAt: new Date('2026-01-01Z') }),
      rule({ id: 'newer', propertyId: PROPERTY, createdAt: new Date('2026-06-01Z') }),
    ]
    expect(resolveCommission(samePriority, target, 1500).ruleId).toBe('newer')
  })
})

describe('splitEarnings', () => {
  const commission = resolveCommission(
    [rule({ id: 'r', propertyId: PROPERTY, hotelShare: 1500, platformShare: 500 })],
    target,
    1500,
  )

  it('splits gross three ways and balances exactly', () => {
    const split = splitEarnings(money(285_000), commission, 3)
    expect(split.hotel.amountMinor).toBe(42_750)
    expect(split.platform.amountMinor).toBe(14_250)
    expect(split.supplier.amountMinor).toBe(228_000)
    expect(split.hotel.amountMinor + split.platform.amountMinor + split.supplier.amountMinor).toBe(
      285_000,
    )
  })

  it('balances on amounts that do not divide cleanly', () => {
    for (const gross of [1, 3, 7, 99, 1_234_567]) {
      const split = splitEarnings(money(gross), commission)
      expect(split.hotel.amountMinor + split.platform.amountMinor + split.supplier.amountMinor).toBe(
        gross,
      )
      expect(split.supplier.amountMinor).toBeGreaterThanOrEqual(0)
    }
  })

  it('handles a fixed per-unit commission', () => {
    const fixed = resolveCommission(
      [
        rule({
          id: 'fixed',
          propertyId: PROPERTY,
          basis: CommissionBasis.FIXED_PER_UNIT,
          hotelShare: 5_000,
          platformShare: 1_000,
        }),
      ],
      target,
      1500,
    )
    const split = splitEarnings(money(60_000), fixed, 2)
    expect(split.hotel.amountMinor).toBe(10_000)
    expect(split.platform.amountMinor).toBe(2_000)
    expect(split.supplier.amountMinor).toBe(48_000)
  })

  it('refuses a fixed commission larger than the sale', () => {
    const fixed = resolveCommission(
      [
        rule({
          id: 'greedy',
          propertyId: PROPERTY,
          basis: CommissionBasis.FIXED_PER_UNIT,
          hotelShare: 50_000,
          platformShare: 50_000,
        }),
      ],
      target,
      1500,
    )
    expect(() => splitEarnings(money(10_000), fixed, 1)).toThrow(/exceeds gross/)
  })

  it('refuses percentage shares that exceed the sale', () => {
    const impossible = {
      ruleId: 'x',
      basis: CommissionBasis.PERCENT_OF_GROSS,
      hotelShare: 7000,
      platformShare: 4000,
      specificity: 'property' as const,
    }
    expect(() => splitEarnings(money(10_000), impossible)).toThrow(/exceeds gross/)
  })
})

describe('potentialHotelEarnings', () => {
  it('is the hotel share of a hypothetical sale, and nothing more', () => {
    const commission = resolveCommission(
      [rule({ id: 'r', propertyId: PROPERTY, hotelShare: 2000, platformShare: 500 })],
      target,
      1500,
    )
    expect(potentialHotelEarnings(money(100_000), commission).amountMinor).toBe(20_000)
  })
})
