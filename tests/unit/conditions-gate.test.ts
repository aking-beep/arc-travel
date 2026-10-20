import { describe, expect, it } from 'vitest'
import { AbilityLevel, ConditionsRisk } from '@/lib/prisma-types'
import {
  abilityRank,
  gateByConditions,
  riskRank,
  STALE_AFTER_HOURS,
  type ConditionsSnapshot,
} from '@/modules/destination/conditions'

/**
 * The safety gate.
 *
 * These are the most important unit tests in the project. Every case here
 * describes a way the product could put someone in the water on the wrong day,
 * and the gate's job is to make that impossible before any scoring, ranking or
 * language model is involved.
 */
function snapshot(partial: Partial<ConditionsSnapshot> = {}): ConditionsSnapshot {
  return {
    placeId: 'place-1',
    forDate: '2026-11-02',
    risk: ConditionsRisk.LOW,
    minAbilityRequired: AbilityLevel.BEGINNER,
    guideRecommended: false,
    waveHeightMinM: 0.4,
    waveHeightMaxM: 1.1,
    windKph: 10,
    windDirection: 'NW',
    waterTempC: 28,
    highTideLocal: '06:30',
    lowTideLocal: '12:42',
    currentNotesEn: 'Light circulation inside the cove.',
    currentNotesEs: null,
    source: 'test fixture',
    observedAt: new Date('2026-11-02T05:30:00Z'),
    ageHours: 2,
    isStale: false,
    ...partial,
  }
}

const base = {
  guestAbility: AbilityLevel.BEGINNER,
  activityMaxSafeRisk: ConditionsRisk.MODERATE,
  activityMinAbility: AbilityLevel.BEGINNER,
  activityGuideRequired: false,
  experienceGuideIncluded: false,
  conditionsSensitive: true,
  placeBaselineRisk: ConditionsRisk.LOW,
}

describe('ordering helpers', () => {
  it('ranks risk from low to extreme', () => {
    expect(riskRank(ConditionsRisk.LOW)).toBeLessThan(riskRank(ConditionsRisk.MODERATE))
    expect(riskRank(ConditionsRisk.MODERATE)).toBeLessThan(riskRank(ConditionsRisk.HIGH))
    expect(riskRank(ConditionsRisk.HIGH)).toBeLessThan(riskRank(ConditionsRisk.EXTREME))
  })

  it('ranks ability from beginner to expert', () => {
    expect(abilityRank(AbilityLevel.BEGINNER)).toBe(0)
    expect(abilityRank(AbilityLevel.EXPERT)).toBe(4)
  })
})

describe('gateByConditions', () => {
  it('allows a calm day for a beginner activity', () => {
    const gate = gateByConditions({ ...base, snapshot: snapshot() })
    expect(gate.allowed).toBe(true)
    expect(gate.exclusions).toEqual([])
  })

  it('blocks an activity when the day exceeds the risk it may run in', () => {
    const gate = gateByConditions({
      ...base,
      snapshot: snapshot({ risk: ConditionsRisk.HIGH, minAbilityRequired: AbilityLevel.ADVANCED }),
    })
    expect(gate.allowed).toBe(false)
    expect(gate.exclusions).toContain('conditions_risk_above_activity_limit')
    expect(gate.notes.join(' ')).toMatch(/does not run above moderate/)
  })

  it('blocks a guest whose ability is below what the day demands', () => {
    const gate = gateByConditions({
      ...base,
      activityMaxSafeRisk: ConditionsRisk.EXTREME,
      snapshot: snapshot({
        risk: ConditionsRisk.HIGH,
        minAbilityRequired: AbilityLevel.ADVANCED,
      }),
    })
    expect(gate.allowed).toBe(false)
    expect(gate.exclusions).toContain('conditions_demand_higher_ability')
  })

  it('allows a sufficiently able guest on a demanding day', () => {
    const gate = gateByConditions({
      ...base,
      guestAbility: AbilityLevel.EXPERT,
      activityMinAbility: AbilityLevel.ADVANCED,
      activityMaxSafeRisk: ConditionsRisk.EXTREME,
      snapshot: snapshot({ risk: ConditionsRisk.EXTREME, minAbilityRequired: AbilityLevel.EXPERT }),
    })
    expect(gate.allowed).toBe(true)
  })

  it('blocks a guest below the activity’s own ability floor, conditions aside', () => {
    const gate = gateByConditions({
      ...base,
      guestAbility: AbilityLevel.IMPROVER,
      activityMinAbility: AbilityLevel.ADVANCED,
      snapshot: snapshot(),
    })
    expect(gate.allowed).toBe(false)
    expect(gate.exclusions).toContain('ability_below_activity_minimum')
  })

  it('never treats an unknown ability as expert on a demanding day', () => {
    const gate = gateByConditions({
      ...base,
      guestAbility: null,
      activityMaxSafeRisk: ConditionsRisk.EXTREME,
      snapshot: snapshot({ risk: ConditionsRisk.HIGH, minAbilityRequired: AbilityLevel.ADVANCED }),
    })
    expect(gate.allowed).toBe(false)
    expect(gate.exclusions).toContain('ability_unknown_and_conditions_demanding')
    expect(gate.notes.join(' ')).toMatch(/will not guess/)
  })

  it('allows an unknown ability on a gentle day', () => {
    const gate = gateByConditions({ ...base, guestAbility: null, snapshot: snapshot() })
    expect(gate.allowed).toBe(true)
  })

  it('treats a missing reading as the place’s baseline, not as permission', () => {
    const gate = gateByConditions({
      ...base,
      snapshot: null,
      placeBaselineRisk: ConditionsRisk.EXTREME,
    })
    expect(gate.allowed).toBe(false)
    expect(gate.usedBaseline).toBe(true)
    expect(gate.exclusions).toContain('conditions_risk_above_activity_limit')
    expect(gate.notes.join(' ')).toMatch(/No conditions reading/)
  })

  it('falls back to HIGH when there is neither a reading nor a baseline', () => {
    const gate = gateByConditions({
      ...base,
      snapshot: null,
      placeBaselineRisk: null,
    })
    // MODERATE activity limit vs. a HIGH assumption: refused.
    expect(gate.allowed).toBe(false)
  })

  it('blocks a guide-required activity sold without a guide', () => {
    const gate = gateByConditions({
      ...base,
      activityGuideRequired: true,
      experienceGuideIncluded: false,
      snapshot: snapshot(),
    })
    expect(gate.allowed).toBe(false)
    expect(gate.exclusions).toContain('guide_required_but_not_included')
  })

  it('allows a guide-required activity that includes one', () => {
    const gate = gateByConditions({
      ...base,
      activityGuideRequired: true,
      experienceGuideIncluded: true,
      snapshot: snapshot(),
    })
    expect(gate.allowed).toBe(true)
  })

  it('warns about a stale reading without silently allowing it through unflagged', () => {
    const gate = gateByConditions({
      ...base,
      snapshot: snapshot({ isStale: true, ageHours: STALE_AFTER_HOURS + 6 }),
    })
    expect(gate.allowed).toBe(true)
    expect(gate.notes.join(' ')).toMatch(/hours old/)
  })

  it('surfaces a guide recommendation as a note', () => {
    const gate = gateByConditions({ ...base, snapshot: snapshot({ guideRecommended: true }) })
    expect(gate.notes.join(' ')).toMatch(/guide is recommended/)
  })

  it('skips the conditions checks for a land activity', () => {
    const gate = gateByConditions({
      ...base,
      conditionsSensitive: false,
      snapshot: null,
      placeBaselineRisk: ConditionsRisk.EXTREME,
    })
    expect(gate.allowed).toBe(true)
    expect(gate.usedBaseline).toBe(false)
    expect(gate.snapshot).toBeNull()
  })

  it('still enforces the ability floor on a land activity', () => {
    const gate = gateByConditions({
      ...base,
      conditionsSensitive: false,
      guestAbility: AbilityLevel.BEGINNER,
      activityMinAbility: AbilityLevel.ADVANCED,
      snapshot: null,
    })
    expect(gate.allowed).toBe(false)
    expect(gate.exclusions).toContain('ability_below_activity_minimum')
  })

  it('reports every independent failure at once, not just the first', () => {
    const gate = gateByConditions({
      ...base,
      guestAbility: AbilityLevel.BEGINNER,
      activityMinAbility: AbilityLevel.ADVANCED,
      activityGuideRequired: true,
      experienceGuideIncluded: false,
      activityMaxSafeRisk: ConditionsRisk.LOW,
      snapshot: snapshot({ risk: ConditionsRisk.EXTREME, minAbilityRequired: AbilityLevel.EXPERT }),
    })
    expect(gate.exclusions).toEqual(
      expect.arrayContaining([
        'guide_required_but_not_included',
        'ability_below_activity_minimum',
        'conditions_risk_above_activity_limit',
        'conditions_demand_higher_ability',
      ]),
    )
  })

  it('never returns a claim that anything is safe', () => {
    const gate = gateByConditions({ ...base, snapshot: snapshot() })
    const everything = [...gate.notes, JSON.stringify(gate)].join(' ').toLowerCase()
    expect(everything).not.toMatch(/\bis safe\b/)
    expect(everything).not.toMatch(/\bsafe to\b/)
    expect(gate).not.toHaveProperty('safe')
  })
})
