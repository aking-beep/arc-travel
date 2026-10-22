import { describe, expect, it } from 'vitest'
import { FixtureTravelAdviceProvider } from '@/modules/integrations/defaults'
import {
  providerFailed,
  providerOk,
  type TravelAdviceProvider,
} from '@/modules/integrations/types'
import { buildBrief, unsupportedDestinationBrief } from '@/modules/culture-context/brief'
import type { TravelerProfileInput } from '@/modules/culture-context/schemas'

/**
 * The brief service.
 *
 * Covers what culture-context never tested: the service itself, the
 * source-unavailable path (MVP acceptance criterion 3), and the
 * `no-fabrication.jsonl` eval cases, which had no runner.
 */
const NOW = new Date('2026-10-21T12:00:00Z')

const mexicoGuest = (overrides: Partial<TravelerProfileInput> = {}): TravelerProfileInput => ({
  nationality: 'GB',
  destinationCountry: 'MX',
  destinationSlug: 'mexico',
  activities: [],
  ...overrides,
})

const failing = (reason: string): TravelAdviceProvider => ({
  name: 'govuk',
  isLive: true,
  getAdvice: async () => providerFailed('govuk', reason),
})

const codes = (warnings: Array<{ code: string }>) => warnings.map((w) => w.code)

describe('buildBrief with the fixture', () => {
  it('returns entry, laws and safety for a guest who declared nothing', async () => {
    const brief = await buildBrief(mexicoGuest(), {
      travelAdvice: new FixtureTravelAdviceProvider(),
      now: NOW,
    })
    expect(brief.items.map((i) => i.category)).toEqual(['entry', 'laws-customs', 'safety'])
    expect(brief.coverage).toBe('PARTIAL')
    expect(brief.generatedAt).toEqual(NOW)
  })

  it('always warns that coverage is partial and that advice is not law, and flags the fixture', async () => {
    const brief = await buildBrief(mexicoGuest(), {
      travelAdvice: new FixtureTravelAdviceProvider(),
    })
    expect(codes(brief.warnings)).toEqual(['COVERAGE_PARTIAL', 'ADVISORY_NOT_LAW', 'FIXTURE_DATA'])
    expect(brief.sources[0]).toMatchObject({ ok: true, isFixture: true, provider: 'fixture' })
  })

  it('warns when nationality is unknown rather than assuming one', async () => {
    const brief = await buildBrief(mexicoGuest({ nationality: null }), {
      travelAdvice: new FixtureTravelAdviceProvider(),
    })
    expect(codes(brief.warnings)).toContain('NATIONALITY_UNKNOWN')
  })

  it('gives a reason for every item, from data', async () => {
    const brief = await buildBrief(mexicoGuest({ activities: ['driving'] }), {
      travelAdvice: new FixtureTravelAdviceProvider(),
    })
    const laws = brief.items.find((i) => i.category === 'laws-customs')!
    expect(laws.relevance).toContain('topic:driving')
    for (const item of brief.items) expect(item.relevance.length).toBeGreaterThan(0)
  })
})

describe('advisory never becomes law (service)', () => {
  it('produces no LAW item from GOV.UK, and every item is unverified', async () => {
    const brief = await buildBrief(mexicoGuest({ activities: ['driving', 'surfing'] }), {
      travelAdvice: new FixtureTravelAdviceProvider(),
    })
    expect(brief.items.length).toBeGreaterThan(0)
    for (const item of brief.items) {
      expect(item.kind).toBe('ADVISORY')
      expect(item.verification).toBe('UNVERIFIED')
      expect(item.sources.every((s) => s.sourceClass === 'GOVERNMENT_ADVISORY')).toBe(true)
    }
  })

  it('carries the OGL attribution on every GOV.UK item', async () => {
    const brief = await buildBrief(mexicoGuest(), {
      travelAdvice: new FixtureTravelAdviceProvider(),
    })
    for (const item of brief.items) {
      expect(item.sources[0]!.attribution).toMatch(/Open Government Licence v3\.0/)
    }
  })
})

describe('source down: a warning, never a filled gap', () => {
  it.each(['http_503', 'timeout', 'network_error'])(
    'on %s returns no items and a SOURCE_UNAVAILABLE warning with the reason',
    async (reason) => {
      const brief = await buildBrief(mexicoGuest(), { travelAdvice: failing(reason) })
      expect(brief.items).toEqual([])
      expect(brief.warnings).toContainEqual({
        code: 'SOURCE_UNAVAILABLE',
        sourceKey: 'govuk:mexico',
        reason,
      })
      expect(brief.sources[0]).toMatchObject({ ok: false, reason, retrievedAt: null })
    },
  )

  it('degrades the same way when a provider throws instead of failing', async () => {
    const brief = await buildBrief(mexicoGuest(), {
      travelAdvice: {
        name: 'broken',
        isLive: true,
        getAdvice: async () => {
          throw new Error('boom')
        },
      },
    })
    expect(brief.items).toEqual([])
    expect(codes(brief.warnings)).toContain('SOURCE_UNAVAILABLE')
  })

  it('treats a payload with no expected sections as unparseable, not as "no rules"', async () => {
    const brief = await buildBrief(mexicoGuest(), {
      travelAdvice: {
        name: 'govuk',
        isLive: true,
        getAdvice: async () =>
          providerOk('govuk', {
            slug: 'mexico',
            sourceUrl: 'https://www.gov.uk/foreign-travel-advice/mexico',
            payload: { title: 'Changed shape', details: {} },
            retrievedAt: NOW,
            isFixture: false,
          }),
      },
    })
    expect(brief.items).toEqual([])
    expect(codes(brief.warnings)).toContain('SOURCE_UNPARSEABLE')
    expect(brief.sources[0]!.ok).toBe(false)
  })

  // no-fabrication.jsonl, case "source-unavailable": the unavailable state must
  // not contain words that state a requirement or a consequence.
  it('contains no requirement or penalty language when the source is unavailable', async () => {
    const brief = await buildBrief(mexicoGuest(), { travelAdvice: failing('http_503') })
    const text = JSON.stringify(brief).toLowerCase()
    for (const word of ['fine', 'penalty', 'illegal', 'required']) {
      expect(text).not.toContain(word)
    }
  })
})

describe('unsupportedDestinationBrief', () => {
  it('says the destination is not covered and shows nothing', () => {
    const brief = unsupportedDestinationBrief(NOW)
    expect(brief.items).toEqual([])
    expect(codes(brief.warnings)).toContain('DESTINATION_UNSUPPORTED')
  })
})
