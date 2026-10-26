import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { referenceCandidates } from '@/modules/guest/account'
import {
  claimStaySchema,
  guestSignUpSchema,
  portalAccountSignUpSchema,
} from '@/modules/guest/schemas'

/**
 * Reading a booking reference off a printed confirmation.
 *
 * References are minted as `STAY-7K4M-QX2P`, and people type them without the
 * hyphens, in lower case, with a space in the middle. None of that is a reason
 * to refuse a claim — the claim's safety comes from needing the address as
 * well (ADR-039), not from the typing. These tests pin the leniency so a later
 * tightening is a deliberate choice rather than a regression.
 */
const PASSWORD = 'a perfectly ordinary passphrase'

describe('referenceCandidates', () => {
  it('accepts the canonical form', () => {
    expect(referenceCandidates('STAY-7K4M-QX2P')).toContain('STAY-7K4M-QX2P')
  })

  it('restores the hyphens somebody dropped', () => {
    expect(referenceCandidates('STAY7K4MQX2P')).toContain('STAY-7K4M-QX2P')
  })

  it('also offers the compact form, for a property that mints references its own way', () => {
    expect(referenceCandidates('STAY-7K4M-QX2P')).toContain('STAY7K4MQX2P')
  })

  it('leaves a reference it does not recognise alone', () => {
    expect(referenceCandidates('BOOKING99')).toEqual(['BOOKING99'])
  })

  it('never returns duplicates', () => {
    const candidates = referenceCandidates('ABCD')
    expect(candidates).toEqual([...new Set(candidates)])
  })
})

describe('guestSignUpSchema', () => {
  const valid = {
    name: 'Ana Rivera',
    email: 'Ana.Rivera@Example.com',
    reference: '  stay-7k4m-qx2p ',
    password: PASSWORD,
    confirmPassword: PASSWORD,
    acceptedTerms: true,
  }

  it('normalises the address and the reference', () => {
    const parsed = guestSignUpSchema.parse(valid)
    expect(parsed.email).toBe('ana.rivera@example.com')
    expect(parsed.reference).toBe('STAY-7K4M-QX2P')
  })

  it('refuses two passwords that do not match', () => {
    expect(() => guestSignUpSchema.parse({ ...valid, confirmPassword: 'something else' })).toThrow(
      ZodError,
    )
  })

  it('refuses an unaccepted terms checkbox', () => {
    expect(() => guestSignUpSchema.parse({ ...valid, acceptedTerms: false })).toThrow(ZodError)
  })

  it('refuses a reference with punctuation in it', () => {
    expect(() => guestSignUpSchema.parse({ ...valid, reference: 'STAY/7K4M' })).toThrow(ZodError)
  })
})

describe('claimStaySchema', () => {
  it('leaves the address out when the form did', () => {
    expect(claimStaySchema.parse({ reference: 'STAY-7K4M-QX2P' }).email).toBeUndefined()
  })

  it('still requires a reference', () => {
    expect(() => claimStaySchema.parse({ email: 'ana@example.com' })).toThrow(ZodError)
  })
})

describe('portalAccountSignUpSchema', () => {
  it('asks for a name and a password and nothing else', () => {
    const parsed = portalAccountSignUpSchema.parse({
      name: 'Ana Rivera',
      password: PASSWORD,
      confirmPassword: PASSWORD,
      acceptedTerms: true,
    })
    expect(parsed).toMatchObject({ name: 'Ana Rivera', acceptedTerms: true })
    // No reference and no address: the token behind the form is the proof.
    expect(parsed).not.toHaveProperty('reference')
    expect(parsed).not.toHaveProperty('email')
  })
})
