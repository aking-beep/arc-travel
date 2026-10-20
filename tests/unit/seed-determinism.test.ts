import { describe, expect, it } from 'vitest'
import { createRng, seededReference, seededToken } from '../../prisma/seed/rng'
import { generateConditions } from '../../prisma/seed/conditions'
import { ACTIVITIES, EXPERIENCES, SUPPLIERS } from '../../prisma/seed/catalog'
import { PLACES, TRAVEL_EDGES } from '../../prisma/seed/destination'
import { GUESTS, ROOM_TYPES } from '../../prisma/seed/people'

/**
 * Seed determinism.
 *
 * The demo seed claims to produce identical data on every run, and Playwright
 * specs plus demo screenshots depend on that. These tests hold the claim
 * honest at the level where it is actually decided: the PRNG and the pure
 * generators built on it.
 */
const SEED = 20_251_020

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(SEED)
    const b = createRng(SEED)

    const drawA = Array.from({ length: 50 }, () => a.next())
    const drawB = Array.from({ length: 50 }, () => b.next())

    expect(drawA).toEqual(drawB)
  })

  it('produces a different sequence for a different seed', () => {
    const a = createRng(SEED)
    const b = createRng(SEED + 1)
    expect(Array.from({ length: 20 }, () => a.next())).not.toEqual(
      Array.from({ length: 20 }, () => b.next()),
    )
  })

  it('stays inside the requested integer range', () => {
    const rng = createRng(SEED)
    for (let i = 0; i < 500; i += 1) {
      const value = rng.int(3, 7)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(3)
      expect(value).toBeLessThanOrEqual(7)
    }
  })

  it('samples without replacement and never exceeds the pool', () => {
    const rng = createRng(SEED)
    const pool = ['a', 'b', 'c', 'd']

    const three = rng.sample(pool, 3)
    expect(three).toHaveLength(3)
    expect(new Set(three).size).toBe(3)

    // Asking for more than exists returns the whole pool, not duplicates.
    const tooMany = rng.sample(pool, 99)
    expect(tooMany).toHaveLength(4)
    expect(new Set(tooMany).size).toBe(4)
  })

  it('refuses to pick from an empty list rather than returning undefined', () => {
    const rng = createRng(SEED)
    expect(() => rng.pick([])).toThrow(/empty list/)
  })

  it('generates readable references with no ambiguous characters', () => {
    const rng = createRng(SEED)
    for (let i = 0; i < 100; i += 1) {
      const reference = seededReference(rng, 'STAY')
      // No 0/O/1/I/L, so a reference can be read aloud at a front desk.
      expect(reference).toMatch(/^STAY-[2-9A-HJ-NP-Z]{4}$/)
    }
  })

  it('generates URL-safe portal tokens of the requested length', () => {
    const rng = createRng(SEED)
    const token = seededToken(rng, 32)
    expect(token).toHaveLength(32)
    expect(token).toMatch(/^[a-z0-9]+$/)
  })
})

describe('generateConditions', () => {
  const places = ['playa-zicatela', 'playa-carrizalillo', 'playa-bacocho']
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']

  it('is reproducible for the same seed', () => {
    const first = generateConditions(createRng(SEED), places, dates)
    const second = generateConditions(createRng(SEED), places, dates)
    expect(first).toEqual(second)
  })

  it('covers every requested place and date', () => {
    const reports = generateConditions(createRng(SEED), places, dates)
    expect(reports).toHaveLength(places.length * dates.length)
  })

  it('never produces a maximum wave height below the minimum', () => {
    const reports = generateConditions(createRng(SEED), places, dates)
    for (const report of reports) {
      expect(report.waveHeightMaxM).toBeGreaterThanOrEqual(report.waveHeightMinM)
    }
  })

  it('keeps each spot inside its real character', () => {
    const reports = generateConditions(createRng(SEED), places, dates)

    // Zicatela is a heavy, advanced-only beach break; the fixtures must not
    // generate a calm day there, because the safety story depends on it.
    for (const report of reports.filter((r) => r.placeSlug === 'playa-zicatela')) {
      expect(['HIGH', 'EXTREME']).toContain(report.risk)
      expect(report.waveHeightMinM).toBeGreaterThanOrEqual(1.5)
      expect(report.guideRecommended).toBe(true)
    }

    // Carrizalillo is the sheltered cove where beginner lessons happen.
    for (const report of reports.filter((r) => r.placeSlug === 'playa-carrizalillo')) {
      expect(['LOW', 'MODERATE']).toContain(report.risk)
      expect(report.waveHeightMaxM).toBeLessThan(2)
    }
  })

  it('pairs the demanded ability with the risk band, never optimistically', () => {
    const reports = generateConditions(createRng(SEED), places, dates)
    const expected = {
      LOW: 'BEGINNER',
      MODERATE: 'IMPROVER',
      HIGH: 'ADVANCED',
      EXTREME: 'EXPERT',
    } as const

    for (const report of reports) {
      expect(report.minAbilityRequired).toBe(expected[report.risk])
    }
  })

  it('skips a place it has no band for rather than inventing one', () => {
    const reports = generateConditions(createRng(SEED), ['centro-adoquin'], dates)
    expect(reports).toHaveLength(0)
  })

  it('produces valid local times for tides', () => {
    const reports = generateConditions(createRng(SEED), places, dates)
    for (const report of reports) {
      expect(report.highTideLocal).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
      expect(report.lowTideLocal).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
    }
  })
})

describe('fixture integrity', () => {
  it('matches the counts the POC promises', () => {
    expect(PLACES).toHaveLength(13)
    expect(SUPPLIERS).toHaveLength(6)
    expect(EXPERIENCES).toHaveLength(10)
    expect(GUESTS).toHaveLength(20)
    expect(ROOM_TYPES.reduce((n, r) => n + r.roomCount, 0)).toBe(20)
  })

  it('has no duplicate slugs anywhere', () => {
    for (const [label, slugs] of [
      ['places', PLACES.map((p) => p.slug)],
      ['activities', ACTIVITIES.map((a) => a.slug)],
      ['suppliers', SUPPLIERS.map((s) => s.slug)],
      ['experiences', EXPERIENCES.map((e) => e.slug)],
    ] as const) {
      expect(new Set(slugs).size, `${label} slugs are unique`).toBe(slugs.length)
    }
  })

  it('has no duplicate guest emails', () => {
    const emails = GUESTS.map((g) => g.email)
    expect(new Set(emails).size).toBe(emails.length)
  })

  it('references only places and activities that exist', () => {
    const placeSlugs = new Set(PLACES.map((p) => p.slug))
    const activitySlugs = new Set(ACTIVITIES.map((a) => a.slug))
    const supplierSlugs = new Set(SUPPLIERS.map((s) => s.slug))

    for (const place of PLACES) {
      if (place.parentSlug) expect(placeSlugs.has(place.parentSlug)).toBe(true)
    }
    for (const activity of ACTIVITIES) {
      expect(placeSlugs.has(activity.placeSlug)).toBe(true)
    }
    for (const edge of TRAVEL_EDGES) {
      expect(placeSlugs.has(edge.from)).toBe(true)
      expect(placeSlugs.has(edge.to)).toBe(true)
    }
    for (const experience of EXPERIENCES) {
      expect(activitySlugs.has(experience.activitySlug)).toBe(true)
      expect(supplierSlugs.has(experience.supplierSlug)).toBe(true)
      expect(placeSlugs.has(experience.placeSlug)).toBe(true)
    }
  })

  it('has every activity ability range the right way round', () => {
    const order = ['BEGINNER', 'IMPROVER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']
    for (const activity of ACTIVITIES) {
      expect(
        order.indexOf(activity.minAbility),
        `${activity.slug} ability range`,
      ).toBeLessThanOrEqual(order.indexOf(activity.maxAbility))
    }
  })

  it('offers every experience within its activity’s sensible hours', () => {
    for (const experience of EXPERIENCES) {
      const activity = ACTIVITIES.find((a) => a.slug === experience.activitySlug)
      expect(activity, experience.slug).toBeDefined()
      for (const startTime of experience.startTimes) {
        expect(
          startTime >= activity!.earliestStart && startTime <= activity!.latestStart,
          `${experience.slug} starts at ${startTime}, outside ${activity!.earliestStart}–${activity!.latestStart}`,
        ).toBe(true)
      }
    }
  })

  it('never claims a certification without marking it as a claim', () => {
    for (const supplier of SUPPLIERS) {
      for (const certification of supplier.claimedCertifications) {
        expect(certification, `${supplier.slug}: ${certification}`).toMatch(/\(claimed\)/)
      }
    }
  })

  it('labels every fictional supplier as fictional', () => {
    for (const supplier of SUPPLIERS) {
      expect(
        `${supplier.legalName} ${supplier.description}`.toLowerCase(),
        supplier.slug,
      ).toContain('fictional')
    }
  })

  it('declares the heaviest break as advanced-only with a mandatory guide', () => {
    const zicatela = ACTIVITIES.find((a) => a.slug === 'zicatela-guided-session')
    expect(zicatela).toBeDefined()
    expect(zicatela!.minAbility).toBe('ADVANCED')
    expect(zicatela!.guideRequired).toBe(true)
    expect(zicatela!.placeSlug).toBe('playa-zicatela')
  })
})
