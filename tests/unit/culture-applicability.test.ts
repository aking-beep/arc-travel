import { describe, expect, it } from 'vitest'
import { SourceClass } from '@/lib/prisma-types'
import { rankBriefItems, relevance, toBriefItem } from '@/modules/culture-context/applicability'
import {
  ruleRecordSchema,
  travelerProfileSchema,
  type RuleRecordInput,
  type TravelerProfileInput,
} from '@/modules/culture-context/schemas'

/**
 * Applicability.
 *
 * The first two cases are ported from culture-context's
 * `services/api/tests/test_applicability.py` and keep its semantics: a rule
 * scoped to an activity needs that activity, and a rule for another country
 * never applies. The rest pin the laws-section fix.
 */
const source = () => ({
  id: 's1',
  authority: 'Test authority',
  url: 'https://example.com/rule',
  jurisdiction: 'JP',
  sourceClass: SourceClass.REGULATOR_GUIDANCE,
  retrievedAt: new Date('2026-10-01T00:00:00Z'),
})

const rule = (input: Omit<RuleRecordInput, 'sources'>) =>
  ruleRecordSchema.parse({ ...input, sources: [source()] })

const traveler = (input: Partial<TravelerProfileInput> = {}) =>
  travelerProfileSchema.parse({
    nationality: 'US',
    destinationCountry: 'JP',
    destinationSlug: 'japan',
    ...input,
  })

describe('ported from test_applicability.py', () => {
  it('an activity-specific rule requires a matching activity', () => {
    const drone = rule({
      id: 'r1',
      jurisdiction: 'JP',
      category: 'activity',
      kind: 'RESTRICTION',
      title: 'Drone rule',
      summary: 'test',
      activityTags: ['drone'],
    })
    expect(relevance(drone, traveler({ activities: ['driving'] }))).toBeNull()
    expect(relevance(drone, traveler({ activities: ['driving', 'drone'] }))?.reasons).toEqual([
      'activity:drone',
    ])
  })

  it('a rule for the wrong jurisdiction never applies', () => {
    const mexico = rule({
      id: 'r2',
      jurisdiction: 'MX',
      category: 'entry',
      kind: 'ADVISORY',
      title: 'Mexico',
      summary: 'test',
    })
    expect(relevance(mexico, traveler())).toBeNull()
  })
})

describe('the laws section is ranked, never dropped', () => {
  // The shape GOV.UK produces: a whole section that happens to mention driving
  // and alcohol. Before the fix these were activity tags, and the section
  // vanished for anyone who had not declared one of them.
  const laws = rule({
    id: 'laws',
    jurisdiction: 'JP',
    category: 'laws-customs',
    kind: 'ADVISORY',
    title: 'Local laws and customs',
    summary: 'Driving licences, alcohol, medication.',
    topicTags: ['driving', 'nightlife', 'medication'],
  })

  it('is kept for a traveller who declared no activities at all', () => {
    const match = relevance(laws, traveler({ activities: [] }))
    expect(match).not.toBeNull()
    expect(match?.reasons).toEqual(['destination'])
  })

  it('is kept for a traveller whose activities it does not mention', () => {
    expect(relevance(laws, traveler({ activities: ['surfing'] }))).not.toBeNull()
  })

  it('ranks higher, with a reason, when it mentions what the traveller will do', () => {
    const plain = relevance(laws, traveler({ activities: [] }))
    const driver = relevance(laws, traveler({ activities: ['driving'] }))
    expect(driver?.reasons).toEqual(['topic:driving'])
    expect(driver!.score).toBeGreaterThan(plain!.score)
  })

  it('sorts a matching item above a non-matching one in the same section', () => {
    const other = rule({
      id: 'other',
      jurisdiction: 'JP',
      category: 'laws-customs',
      kind: 'ADVISORY',
      title: 'A general note',
      summary: 'Nothing about driving.',
    })
    const t = traveler({ activities: ['driving'] })
    const items = [toBriefItem(other, t)!, toBriefItem(laws, t)!]
    expect(rankBriefItems(items).map((i) => i.id)).toEqual(['laws', 'other'])
  })
})

describe('nationality', () => {
  const visa = rule({
    id: 'visa',
    jurisdiction: 'JP',
    category: 'entry',
    kind: 'ADVISORY',
    title: 'Visa for US citizens',
    summary: 'test',
    nationalityTags: ['US'],
  })

  it('excludes a definite mismatch', () => {
    expect(relevance(visa, traveler({ nationality: 'GB' }))).toBeNull()
  })

  it('shows a rule as uncertain, rather than dropping it, when nationality is unknown', () => {
    const match = relevance(visa, traveler({ nationality: null }))
    expect(match?.uncertain).toBe(true)
    expect(match?.reasons).toContain('nationality:unknown')
  })
})

describe('rankBriefItems', () => {
  it('orders entry, then laws, then safety', () => {
    const t = traveler()
    const make = (id: string, category: 'entry' | 'laws-customs' | 'safety') =>
      toBriefItem(
        rule({ id, jurisdiction: 'JP', category, kind: 'ADVISORY', title: id, summary: 's' }),
        t,
      )!
    const ranked = rankBriefItems([make('c', 'safety'), make('a', 'entry'), make('b', 'laws-customs')])
    expect(ranked.map((i) => i.category)).toEqual(['entry', 'laws-customs', 'safety'])
  })
})
