import { afterEach, describe, expect, it } from 'vitest'
import { resetEnvCache, getEnv } from '@/lib/env'
import { SourceClass, VerificationStatus } from '@/lib/prisma-types'
import { FixtureTravelAdviceProvider } from '@/modules/integrations/defaults'
import { GovUkTravelAdviceProvider } from '@/modules/integrations/govuk'
import type { TravelAdviceDocument } from '@/modules/integrations/types'
import {
  changedSections,
  GOVUK_ATTRIBUTION,
  GOVUK_AUTHORITY,
  parseGovUkAdvice,
} from '@/modules/culture-context/govuk'

/**
 * The GOV.UK adapter, against the repository fixture and against a stubbed
 * fetch. No test here touches the network.
 */
const fixtureDocument = async (): Promise<TravelAdviceDocument> => {
  const result = await new FixtureTravelAdviceProvider().getAdvice({ slug: 'mexico' })
  expect(result.ok).toBe(true)
  return result.data!
}

const doc = (payload: unknown): TravelAdviceDocument => ({
  slug: 'mexico',
  sourceUrl: 'https://www.gov.uk/foreign-travel-advice/mexico',
  payload,
  retrievedAt: new Date('2026-10-01T00:00:00Z'),
  isFixture: false,
})

describe('FixtureTravelAdviceProvider', () => {
  it('serves the Mexico fixture offline, marked as a fixture, with a fixed retrieval time', async () => {
    const document = await fixtureDocument()
    expect(document.isFixture).toBe(true)
    expect(document.sourceUrl).toBe('https://www.gov.uk/foreign-travel-advice/mexico')
    expect(document.retrievedAt.toISOString()).toBe('2026-10-21T00:00:00.000Z')
  })

  it('fails for a country it has no fixture for, rather than borrowing one', async () => {
    const result = await new FixtureTravelAdviceProvider().getAdvice({ slug: 'japan' })
    expect(result).toMatchObject({ ok: false, data: null, reason: 'no_fixture_for_slug' })
  })
})

describe('parseGovUkAdvice against the fixture', () => {
  it('extracts entry, laws and safety, in that order', async () => {
    const parsed = parseGovUkAdvice(await fixtureDocument(), 'mx')
    expect(parsed.rules.map((r) => r.category)).toEqual(['entry', 'laws-customs', 'safety'])
    expect(parsed.rules.every((r) => r.jurisdiction === 'MX')).toBe(true)
  })

  it('labels every record ADVISORY from a GOVERNMENT_ADVISORY source, unverified', async () => {
    const parsed = parseGovUkAdvice(await fixtureDocument(), 'MX')
    for (const rule of parsed.rules) {
      expect(rule.kind).toBe('ADVISORY')
      expect(rule.verification).toBe(VerificationStatus.UNVERIFIED)
      expect(rule.sources.map((s) => s.sourceClass)).toEqual([SourceClass.GOVERNMENT_ADVISORY])
    }
  })

  it('carries authority, link, retrieval time, hash, fixture flag and OGL attribution', async () => {
    const parsed = parseGovUkAdvice(await fixtureDocument(), 'MX')
    expect(parsed.source).toMatchObject({
      authority: GOVUK_AUTHORITY,
      url: 'https://www.gov.uk/foreign-travel-advice/mexico',
      jurisdiction: 'MX',
      licence: 'Open Government Licence v3.0',
      attribution: GOVUK_ATTRIBUTION,
      isFixture: true,
    })
    expect(parsed.source.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('emits topics, never activity scoping, so the laws section cannot be excluded', async () => {
    const parsed = parseGovUkAdvice(await fixtureDocument(), 'MX')
    const laws = parsed.rules.find((r) => r.category === 'laws-customs')!
    expect(laws.activityTags).toEqual([])
    expect(laws.topicTags).toEqual(expect.arrayContaining(['driving', 'medication', 'nightlife']))
    expect(parsed.rules.every((r) => r.activityTags.length === 0)).toBe(true)
  })

  it('strips scripts and styles from section bodies', () => {
    const parsed = parseGovUkAdvice(
      doc({
        details: {
          parts: [
            {
              title: 'Local laws and customs',
              body: '<p>Carry ID.</p><script>alert(1)</script><style>p{}</style>',
            },
          ],
        },
      }),
      'MX',
    )
    expect(parsed.rules[0]!.summary).toBe('Carry ID.')
  })

  it('returns no rules, not invented ones, when no expected section is present', () => {
    expect(parseGovUkAdvice(doc({ details: { parts: [] } }), 'MX').rules).toEqual([])
    expect(parseGovUkAdvice(doc('not an object'), 'MX').rules).toEqual([])
  })

  it('hashes content, not metadata: a new timestamp or updated_at is not a change', async () => {
    const base = await fixtureDocument()
    const a = parseGovUkAdvice(base, 'MX')
    const b = parseGovUkAdvice(
      {
        ...base,
        retrievedAt: new Date('2030-01-01T00:00:00Z'),
        payload: { ...(base.payload as object), public_updated_at: '2030-01-01T00:00:00Z' },
      },
      'MX',
    )
    expect(b.contentHash).toBe(a.contentHash)
  })

  it('reports which sections changed when the text does', async () => {
    const base = await fixtureDocument()
    const before = parseGovUkAdvice(base, 'MX')
    const payload = structuredClone(base.payload) as {
      details: { parts: Array<{ slug: string; body: string }> }
    }
    payload.details.parts.find((p) => p.slug === 'entry-requirements')!.body += '<p>New rule.</p>'
    const after = parseGovUkAdvice({ ...base, payload }, 'MX')
    expect(after.contentHash).not.toBe(before.contentHash)
    expect(changedSections(before.content, after.content)).toEqual(['entry'])
  })
})

describe('GovUkTravelAdviceProvider (stubbed fetch)', () => {
  const provider = (fetch: (url: string) => Promise<Response>) =>
    new GovUkTravelAdviceProvider({ fetch, now: () => new Date('2026-10-21T12:00:00Z') })

  it('reads the content API and links the public page', async () => {
    let requested = ''
    const result = await provider(async (url) => {
      requested = url
      return new Response(JSON.stringify({ title: 'Mexico travel advice' }), { status: 200 })
    }).getAdvice({ slug: 'mexico' })
    expect(requested).toBe('https://www.gov.uk/api/content/foreign-travel-advice/mexico')
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      sourceUrl: 'https://www.gov.uk/foreign-travel-advice/mexico',
      isFixture: false,
    })
  })

  it.each([
    ['http_503', async () => new Response('down', { status: 503 })],
    ['invalid_json', async () => new Response('<html>', { status: 200 })],
    [
      'network_error',
      async () => {
        throw new TypeError('fetch failed')
      },
    ],
    [
      'timeout',
      async () => {
        throw new DOMException('timed out', 'TimeoutError')
      },
    ],
  ] as const)('returns {ok:false, reason: %s} instead of throwing', async (reason, fetch) => {
    const result = await provider(fetch).getAdvice({ slug: 'mexico' })
    expect(result).toEqual({ ok: false, data: null, reason, provider: 'govuk' })
  })

  it('refuses a slug that could alter the request path, without fetching', async () => {
    let called = false
    const result = await provider(async () => {
      called = true
      return new Response('{}')
    }).getAdvice({ slug: '../../admin' })
    expect(result.reason).toBe('invalid_slug')
    expect(called).toBe(false)
  })
})

describe('demo mode stays offline', () => {
  afterEach(() => {
    delete process.env.TRAVEL_ADVICE_PROVIDER
    resetEnvCache()
  })

  it('refuses the live GOV.UK provider while ARC_DATA_MODE=demo', () => {
    process.env.TRAVEL_ADVICE_PROVIDER = 'govuk'
    resetEnvCache()
    expect(() => getEnv()).toThrow(/TRAVEL_ADVICE_PROVIDER/)
  })

  it('defaults to the fixture', () => {
    resetEnvCache()
    expect(getEnv().TRAVEL_ADVICE_PROVIDER).toBe('fixture')
  })
})
