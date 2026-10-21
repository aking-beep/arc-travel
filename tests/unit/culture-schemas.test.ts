import { describe, expect, it } from 'vitest'
import { SourceClass, VerificationStatus } from '@/lib/prisma-types'
import {
  ruleRecordSchema,
  travelerProfileSchema,
  type RuleRecordInput,
  type SourceRefInput,
} from '@/modules/culture-context/schemas'

/**
 * Culture-context schemas.
 *
 * The behaviour under test is "an advisory is never law" at the type level: no
 * adapter, seed or future import can produce a LAW record from a government
 * advisory, because the schema refuses it before anything renders.
 */
const source = (sourceClass: SourceClass): SourceRefInput => ({
  id: 's1',
  authority: 'Test authority',
  url: 'https://example.com/rule',
  jurisdiction: 'MX',
  sourceClass,
  retrievedAt: new Date('2026-10-01T00:00:00Z'),
})

const rule = (overrides: Partial<RuleRecordInput>): RuleRecordInput => ({
  id: 'r1',
  jurisdiction: 'MX',
  category: 'laws-customs',
  kind: 'ADVISORY',
  title: 'Local laws',
  summary: 'Test summary.',
  sources: [source(SourceClass.GOVERNMENT_ADVISORY)],
  ...overrides,
})

describe('advisory never becomes law (schema)', () => {
  it('accepts a government advisory as ADVISORY', () => {
    expect(ruleRecordSchema.parse(rule({})).kind).toBe('ADVISORY')
  })

  it('refuses a LAW record backed only by a government advisory, even when verified', () => {
    const result = ruleRecordSchema.safeParse(
      rule({ kind: 'LAW', verification: VerificationStatus.VERIFIED }),
    )
    expect(result.success).toBe(false)
  })

  it('refuses a LAW record from a primary-law source until an admin verifies it', () => {
    const result = ruleRecordSchema.safeParse(
      rule({ kind: 'LAW', sources: [source(SourceClass.PRIMARY_LAW)] }),
    )
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain('verification')
  })

  it('allows LAW only with a law-grade source and a verification', () => {
    const parsed = ruleRecordSchema.parse(
      rule({
        kind: 'LAW',
        sources: [source(SourceClass.REGULATOR_GUIDANCE)],
        verification: VerificationStatus.VERIFIED,
      }),
    )
    expect(parsed.kind).toBe('LAW')
  })

  it('refuses a RESTRICTION resting only on community context', () => {
    const result = ruleRecordSchema.safeParse(
      rule({ kind: 'RESTRICTION', sources: [source(SourceClass.COMMUNITY_CONTEXT)] }),
    )
    expect(result.success).toBe(false)
  })

  it('defaults a record to UNVERIFIED rather than assuming review happened', () => {
    expect(ruleRecordSchema.parse(rule({})).verification).toBe(VerificationStatus.UNVERIFIED)
  })
})

describe('travelerProfileSchema', () => {
  it('upper-cases ISO codes and lower-cases activity tags', () => {
    const profile = travelerProfileSchema.parse({
      nationality: 'gb',
      destinationCountry: 'mx',
      destinationSlug: 'mexico',
      activities: ['Surfing'],
    })
    expect(profile.nationality).toBe('GB')
    expect(profile.destinationCountry).toBe('MX')
    expect(profile.activities).toEqual(['surfing'])
    expect(profile.purpose).toBe('TOURISM')
  })

  it('records an unknown nationality as null instead of defaulting one', () => {
    const profile = travelerProfileSchema.parse({
      nationality: null,
      destinationCountry: 'MX',
      destinationSlug: 'mexico',
    })
    expect(profile.nationality).toBeNull()
  })

  it('rejects a slug that could escape the source path', () => {
    expect(
      travelerProfileSchema.safeParse({
        nationality: null,
        destinationCountry: 'MX',
        destinationSlug: '../../admin',
      }).success,
    ).toBe(false)
  })
})
