import { describe, expect, it } from 'vitest'

import { VerificationStatus } from '@/lib/prisma-types'
import {
  daysUntilInsuranceExpiry,
  INSURANCE_CHECK_KEY,
  isCurrentlyVerified,
  REQUIRED_CHECK_KEYS,
  VERIFICATION_CHECKS,
  verificationStanding,
} from '@/modules/admin/verification'

const NOW = new Date('2026-06-15T18:00:00Z')

const verified = (overrides: Partial<Parameters<typeof verificationStanding>[0]> = {}) => ({
  verification: VerificationStatus.VERIFIED,
  verifiedChecks: [...REQUIRED_CHECK_KEYS],
  insuranceExpiresOn: new Date('2027-01-31T00:00:00Z'),
  ...overrides,
})

describe('the checklist', () => {
  it('has a unique key per check', () => {
    const keys = VERIFICATION_CHECKS.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('tells the admin what to look at, not just what to tick', () => {
    // A checklist of labels alone would be worse than the free-text note it
    // replaced: it would look like process without transferring any knowledge.
    for (const check of VERIFICATION_CHECKS) {
      expect(check.detail.length).toBeGreaterThan(40)
    }
  })

  it('requires the insurance check, which is the one that expires', () => {
    expect(REQUIRED_CHECK_KEYS).toContain(INSURANCE_CHECK_KEY)
  })
})

describe('verificationStanding', () => {
  it('is verified with every required check and insurance in force', () => {
    const standing = verificationStanding(verified(), NOW)
    expect(standing.standing).toBe('verified')
    expect(standing.reason).toBeNull()
  })

  it('lapses the day after the insurance expires', () => {
    const standing = verificationStanding(
      verified({ insuranceExpiresOn: new Date('2026-06-14T00:00:00Z') }),
      NOW,
    )
    expect(standing.standing).toBe('lapsed')
    expect(standing.expiredOn).toBe('2026-06-14')
  })

  it('still holds on the day the certificate expires', () => {
    // A policy expiring today is cover today. Comparing a midnight timestamp
    // against `now` would expire it a day early everywhere west of UTC, which
    // is all of Mexico.
    const standing = verificationStanding(
      verified({ insuranceExpiresOn: new Date('2026-06-15T00:00:00Z') }),
      NOW,
    )
    expect(standing.standing).toBe('verified')
  })

  it('lapses when insurance was checked but no expiry was recorded', () => {
    // The state every pre-ADR-036 row is in. Reported rather than trusted:
    // nobody can say whether that policy is still in force.
    const standing = verificationStanding(verified({ insuranceExpiresOn: null }), NOW)
    expect(standing.standing).toBe('lapsed')
    expect(standing.reason).toMatch(/no expiry date/i)
  })

  it('does not lapse a verified partner whose insurance check was never recorded', () => {
    // Nothing to expire, so nothing lapses. Such a row should not be VERIFIED
    // in the first place — the service and a CHECK constraint both refuse it —
    // but this function must not invent a failure mode of its own.
    const standing = verificationStanding(
      { verification: VerificationStatus.VERIFIED, verifiedChecks: ['identity'], insuranceExpiresOn: null },
      NOW,
    )
    expect(standing.standing).toBe('verified')
  })

  it('reports how many required checks are outstanding when unverified', () => {
    const standing = verificationStanding(
      { verification: VerificationStatus.UNVERIFIED, verifiedChecks: ['identity'], insuranceExpiresOn: null },
      NOW,
    )
    expect(standing.standing).toBe('unverified')
    expect(standing.missingChecks).not.toContain('identity')
    expect(standing.missingChecks).toContain(INSURANCE_CHECK_KEY)
    expect(standing.reason).toMatch(/not yet recorded/)
  })

  it('distinguishes rejected from merely unverified', () => {
    const standing = verificationStanding(
      { verification: VerificationStatus.REJECTED, verifiedChecks: [], insuranceExpiresOn: null },
      NOW,
    )
    expect(standing.standing).toBe('rejected')
    expect(standing.reason).toMatch(/rejected/)
  })

  it('says so when every check is recorded but nobody decided', () => {
    const standing = verificationStanding(
      {
        verification: VerificationStatus.PENDING,
        verifiedChecks: [...REQUIRED_CHECK_KEYS],
        insuranceExpiresOn: new Date('2027-01-31T00:00:00Z'),
      },
      NOW,
    )
    expect(standing.standing).toBe('unverified')
    expect(standing.reason).toMatch(/no verification decision/)
  })
})

describe('isCurrentlyVerified', () => {
  it('is what the guest surfaces ask, and a lapse answers no', () => {
    expect(isCurrentlyVerified(verified(), NOW)).toBe(true)
    expect(
      isCurrentlyVerified(verified({ insuranceExpiresOn: new Date('2026-01-01T00:00:00Z') }), NOW),
    ).toBe(false)
  })
})

describe('daysUntilInsuranceExpiry', () => {
  it('counts whole days forward', () => {
    expect(
      daysUntilInsuranceExpiry({ insuranceExpiresOn: new Date('2026-06-25T00:00:00Z') }, NOW),
    ).toBe(10)
  })

  it('is zero on the day itself', () => {
    expect(
      daysUntilInsuranceExpiry({ insuranceExpiresOn: new Date('2026-06-15T00:00:00Z') }, NOW),
    ).toBe(0)
  })

  it('goes negative once it has passed', () => {
    expect(
      daysUntilInsuranceExpiry({ insuranceExpiresOn: new Date('2026-06-05T00:00:00Z') }, NOW),
    ).toBe(-10)
  })

  it('is null when there is nothing on file', () => {
    expect(daysUntilInsuranceExpiry({ insuranceExpiresOn: null }, NOW)).toBeNull()
  })
})
