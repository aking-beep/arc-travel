import { describe, expect, it } from 'vitest'
import { clampAbilityRange } from '@/modules/catalog/service'
import { experienceInputSchema } from '@/modules/catalog/schemas'

const base = {
  supplierId: '11111111-1111-4111-8111-111111111111',
  activityId: '22222222-2222-4222-8222-222222222222',
  titleEn: 'Zicatela guided session',
  category: 'SURF',
  durationMinutes: 120,
  minAbility: 'ADVANCED',
  maxAbility: 'EXPERT',
  minParty: 1,
  maxParty: 3,
  defaultCapacity: 3,
  cancellationPolicyHours: 24,
  priceMinor: 210_000,
}

describe('experienceInputSchema', () => {
  it('accepts a well-formed experience', () => {
    expect(experienceInputSchema.safeParse(base).success).toBe(true)
  })

  it('rejects an inverted ability range', () => {
    const result = experienceInputSchema.safeParse({
      ...base,
      minAbility: 'EXPERT',
      maxAbility: 'BEGINNER',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.some((i) => i.path.includes('minAbility'))).toBe(true)
  })

  it('rejects an inverted party range', () => {
    const result = experienceInputSchema.safeParse({ ...base, minParty: 8, maxParty: 2 })
    expect(result.success).toBe(false)
  })

  it('rejects a negative price', () => {
    expect(experienceInputSchema.safeParse({ ...base, priceMinor: -1 }).success).toBe(false)
  })

  it('rejects an unknown category', () => {
    expect(experienceInputSchema.safeParse({ ...base, category: 'SKYDIVING' }).success).toBe(false)
  })
})

describe('clampAbilityRange', () => {
  const activity = { minAbility: 'ADVANCED', maxAbility: 'EXPERT' }

  it('leaves a range inside the activity envelope alone', () => {
    const result = clampAbilityRange({ minAbility: 'ADVANCED', maxAbility: 'EXPERT' }, activity)
    expect(result).toEqual({ minAbility: 'ADVANCED', maxAbility: 'EXPERT', adjustments: [] })
  })

  it('allows a narrower range than the activity', () => {
    const result = clampAbilityRange({ minAbility: 'EXPERT', maxAbility: 'EXPERT' }, activity)
    expect(result.minAbility).toBe('EXPERT')
    expect(result.adjustments).toEqual([])
  })

  it('raises a minimum that is below what the activity allows, and says so', () => {
    // The product-critical case: nobody can make Zicatela a beginner lesson by
    // editing the catalog.
    const result = clampAbilityRange({ minAbility: 'BEGINNER', maxAbility: 'EXPERT' }, activity)
    expect(result.minAbility).toBe('ADVANCED')
    expect(result.adjustments).toHaveLength(1)
    expect(result.adjustments[0]).toContain('ADVANCED')
  })

  it('lowers a maximum that exceeds the activity', () => {
    const gentle = { minAbility: 'BEGINNER', maxAbility: 'IMPROVER' }
    const result = clampAbilityRange({ minAbility: 'BEGINNER', maxAbility: 'EXPERT' }, gentle)
    expect(result.maxAbility).toBe('IMPROVER')
    expect(result.adjustments).toHaveLength(1)
  })

  it('clamps both ends at once', () => {
    const middle = { minAbility: 'IMPROVER', maxAbility: 'INTERMEDIATE' }
    const result = clampAbilityRange({ minAbility: 'BEGINNER', maxAbility: 'EXPERT' }, middle)
    expect(result).toMatchObject({ minAbility: 'IMPROVER', maxAbility: 'INTERMEDIATE' })
    expect(result.adjustments).toHaveLength(2)
  })
})
