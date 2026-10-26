import { describe, expect, it } from 'vitest'
import {
  joinDeclineSchema,
  joinDecisionSchema,
  joinRequestSchema,
  partnerExperienceSchema,
  partnerPriceSchema,
  supplierProfileSchema,
  verificationEvidenceSchema,
} from '@/modules/suppliers/schemas'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const profile = {
  name: 'Escuela Olas Verdes',
  categories: ['SURF'],
  contactEmail: 'Hola@Olas.Example ',
}

const evidence = {
  claimedCertifications: ['ISA Level 1'],
}

const experience = {
  propertyId: uuid(1),
  activityId: uuid(2),
  titleEn: 'Beginner surf lesson',
  durationMinutes: '120',
  minParty: '1',
  maxParty: '4',
  defaultCapacity: '4',
  cancellationPolicyHours: '24',
  priceMinor: '95000',
}

const joinRequest = {
  propertySlug: 'casa-olas',
  businessName: 'Cocina Doña Mar',
  contactName: 'Mar',
  contactEmail: 'mar@example.com',
  categories: ['DINING'],
}

/**
 * The schemas, which are the permission boundary rather than a convenience.
 *
 * ADR-041 draws one line: a partner edits their **claims** and never their
 * **standing**. These tests assert the line where it is actually enforced —
 * `.strict()` means a form field naming a verification column is rejected
 * rather than ignored, which is the difference between a boundary and a
 * service that happens not to read something today.
 */
describe('supplierProfileSchema', () => {
  it('accepts a minimal profile and normalises the address', () => {
    const parsed = supplierProfileSchema.parse(profile)
    expect(parsed.contactEmail).toBe('hola@olas.example')
  })

  it.each([
    'verification',
    'verifiedChecks',
    'verifiedAt',
    'insuranceOnFile',
    'insuranceExpiresOn',
    'status',
    'payoutsEnabled',
    'organizationId',
    'id',
  ])('refuses a %s field rather than ignoring it', (field) => {
    expect(() => supplierProfileSchema.parse({ ...profile, [field]: 'VERIFIED' })).toThrow()
  })

  it('needs at least one category', () => {
    expect(() => supplierProfileSchema.parse({ ...profile, categories: [] })).toThrow(
      /at least one category/i,
    )
  })

  it('refuses a category it does not know', () => {
    expect(() => supplierProfileSchema.parse({ ...profile, categories: ['SKYDIVING'] })).toThrow()
  })

  it('refuses an address that is not one', () => {
    expect(() => supplierProfileSchema.parse({ ...profile, contactEmail: 'not-an-email' })).toThrow(
      /valid email/i,
    )
  })
})

describe('verificationEvidenceSchema', () => {
  it('accepts certifications on their own', () => {
    expect(verificationEvidenceSchema.parse(evidence).claimedCertifications).toEqual([
      'ISA Level 1',
    ])
  })

  it('defaults the certification list rather than demanding one', () => {
    expect(verificationEvidenceSchema.parse({}).claimedCertifications).toEqual([])
  })

  it.each(['verification', 'insuranceOnFile', 'insuranceExpiresOn', 'verifiedChecks'])(
    'cannot name %s',
    (field) => {
      expect(() => verificationEvidenceSchema.parse({ ...evidence, [field]: true })).toThrow()
    },
  )

  it('will not take a policy number with no insurer', () => {
    expect(() =>
      verificationEvidenceSchema.parse({ ...evidence, claimedInsurancePolicyRef: 'POL-1' }),
    ).toThrow(/name the insurer/i)
  })

  it('will not take an expiry with no insurer', () => {
    expect(() =>
      verificationEvidenceSchema.parse({ ...evidence, claimedInsuranceExpiresOn: '2027-01-01' }),
    ).toThrow(/name the insurer/i)
  })

  it('takes insurer, policy and expiry together', () => {
    const parsed = verificationEvidenceSchema.parse({
      ...evidence,
      claimedInsurer: 'Seguros del Pacífico',
      claimedInsurancePolicyRef: 'POL-1',
      claimedInsuranceExpiresOn: '2027-01-01',
    })
    expect(parsed.claimedInsuranceExpiresOn).toBe('2027-01-01')
  })

  it('refuses a date that is not a calendar day', () => {
    expect(() =>
      verificationEvidenceSchema.parse({
        ...evidence,
        claimedInsurer: 'Seguros',
        claimedInsuranceExpiresOn: '01/01/2027',
      }),
    ).toThrow(/YYYY-MM-DD/)
  })
})

describe('partnerExperienceSchema', () => {
  it('coerces the numbers a form sends as strings', () => {
    const parsed = partnerExperienceSchema.parse(experience)
    expect(parsed.durationMinutes).toBe(120)
    expect(parsed.priceMinor).toBe(95_000)
  })

  it('defaults a guide to included and transfer to not', () => {
    const parsed = partnerExperienceSchema.parse(experience)
    expect(parsed.guideIncluded).toBe(true)
    expect(parsed.includesTransfer).toBe(false)
  })

  it.each(['supplierId', 'status', 'slug', 'minAbility', 'maxAbility', 'category'])(
    'has no %s field, so a form cannot set one',
    (field) => {
      expect(() => partnerExperienceSchema.parse({ ...experience, [field]: uuid(9) })).toThrow()
    },
  )

  it('refuses a minimum party above the maximum', () => {
    expect(() =>
      partnerExperienceSchema.parse({ ...experience, minParty: '6', maxParty: '2' }),
    ).toThrow(/cannot exceed/i)
  })

  it('refuses a capacity below the minimum party', () => {
    expect(() =>
      partnerExperienceSchema.parse({ ...experience, minParty: '4', defaultCapacity: '2' }),
    ).toThrow(/at least the minimum/i)
  })

  it('refuses a duration of a few seconds or of days', () => {
    expect(() => partnerExperienceSchema.parse({ ...experience, durationMinutes: '1' })).toThrow()
    expect(() =>
      partnerExperienceSchema.parse({ ...experience, durationMinutes: '5000' }),
    ).toThrow()
  })

  it('takes a free experience, because zero is a price', () => {
    expect(partnerExperienceSchema.parse({ ...experience, priceMinor: '0' }).priceMinor).toBe(0)
  })

  it('refuses a negative price', () => {
    expect(() => partnerExperienceSchema.parse({ ...experience, priceMinor: '-1' })).toThrow()
  })
})

describe('partnerPriceSchema', () => {
  it('defaults the party size the price applies from', () => {
    const parsed = partnerPriceSchema.parse({ experienceId: uuid(1), amountMinor: '80000' })
    expect(parsed.minParty).toBe(1)
  })

  it('has no booking fee, which is ARC’s and not the partner’s', () => {
    expect(() =>
      partnerPriceSchema.parse({
        experienceId: uuid(1),
        amountMinor: '80000',
        bookingFeeMinor: '0',
      }),
    ).toThrow()
  })
})

describe('joinRequestSchema', () => {
  it('accepts a request and defaults the language to Spanish', () => {
    const parsed = joinRequestSchema.parse(joinRequest)
    expect(parsed.locale).toBe('ES')
    expect(parsed.claimedCertifications).toEqual([])
  })

  it('lowercases the address, because that is the key a duplicate is found by', () => {
    const parsed = joinRequestSchema.parse({ ...joinRequest, contactEmail: 'MAR@Example.com' })
    expect(parsed.contactEmail).toBe('mar@example.com')
  })

  it.each(['password', 'supplierId', 'status', 'hotelCommissionBps', 'verification'])(
    'cannot name %s',
    (field) => {
      expect(() => joinRequestSchema.parse({ ...joinRequest, [field]: 'x' })).toThrow()
    },
  )

  it('needs a hotel, a name, a contact and a category', () => {
    for (const field of ['propertySlug', 'businessName', 'contactName', 'contactEmail']) {
      const partial: Record<string, unknown> = { ...joinRequest }
      delete partial[field]
      expect(() => joinRequestSchema.parse(partial)).toThrow()
    }
    expect(() => joinRequestSchema.parse({ ...joinRequest, categories: [] })).toThrow()
  })
})

describe('joinDecisionSchema', () => {
  it('coerces the commission a form sends as a string', () => {
    expect(joinDecisionSchema.parse({ requestId: uuid(1), hotelCommissionBps: '1500' })
      .hotelCommissionBps).toBe(1500)
  })

  it('refuses a commission over half the gross', () => {
    expect(() =>
      joinDecisionSchema.parse({ requestId: uuid(1), hotelCommissionBps: '6000' }),
    ).toThrow()
  })

  it('requires the commission, so accepting cannot silently agree to zero', () => {
    expect(() => joinDecisionSchema.parse({ requestId: uuid(1) })).toThrow()
  })

  it('declining asks for no commission at all', () => {
    expect(joinDeclineSchema.parse({ requestId: uuid(1) }).decisionNote).toBeUndefined()
  })
})
