import { describe, expect, it } from 'vitest'
import {
  PASSWORD_MIN_LENGTH,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '@/lib/password'

/**
 * Password hashing.
 *
 * scrypt from `node:crypto` rather than a native bcrypt or argon2 module, so
 * these tests pin the properties that choice has to hold on to: the stored form
 * carries its own parameters, a wrong password fails, and a malformed or absent
 * hash is a refusal rather than a crash.
 */
describe('hashPassword', () => {
  it('produces a parameterised, salted hash', async () => {
    const hash = await hashPassword('correct horse battery staple')
    const [scheme, n, r, p, salt, key] = hash.split('$')

    expect(scheme).toBe('scrypt')
    expect(Number(n)).toBeGreaterThanOrEqual(2 ** 15)
    expect(Number(r)).toBe(8)
    expect(Number(p)).toBe(1)
    expect(salt).toBeTruthy()
    expect(key).toBeTruthy()
    // The password itself is nowhere in the output.
    expect(hash).not.toContain('correct horse')
  })

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword('the same password twice')
    const b = await hashPassword('the same password twice')
    expect(a).not.toBe(b)
    expect(await verifyPassword('the same password twice', a)).toBe(true)
    expect(await verifyPassword('the same password twice', b)).toBe(true)
  })
})

describe('verifyPassword', () => {
  it('accepts the right password and refuses a wrong one', async () => {
    const hash = await hashPassword('a reasonable passphrase')
    expect(await verifyPassword('a reasonable passphrase', hash)).toBe(true)
    expect(await verifyPassword('a reasonable passphras', hash)).toBe(false)
    expect(await verifyPassword('', hash)).toBe(false)
  })

  it('normalises unicode, so the same typed password works on any keyboard', async () => {
    // U+00F1 and n + U+0303 look identical and are different byte strings.
    const hash = await hashPassword('mañana contraseña')
    expect(await verifyPassword('mañana contraseña', hash)).toBe(true)
  })

  it('refuses rather than throws for an absent or malformed hash', async () => {
    expect(await verifyPassword('anything', null)).toBe(false)
    expect(await verifyPassword('anything', undefined)).toBe(false)
    expect(await verifyPassword('anything', '')).toBe(false)
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false)
    expect(await verifyPassword('anything', 'bcrypt$10$abc$def$ghi')).toBe(false)
  })

  it('refuses a hash claiming absurd parameters instead of honouring them', async () => {
    // Otherwise a tampered row is a denial of service rather than a bad hash.
    const hostile = ['scrypt', 2 ** 24, 64, 64, 'AAAA', 'AAAA'].join('$')
    expect(await verifyPassword('anything', hostile)).toBe(false)
  })
})

describe('needsRehash', () => {
  it('is false for a hash made with the current parameters', async () => {
    expect(needsRehash(await hashPassword('current parameters'))).toBe(false)
  })

  it('is true for a weaker or foreign hash', () => {
    expect(needsRehash(['scrypt', 2 ** 14, 8, 1, 'AA', 'BB'].join('$'))).toBe(true)
    expect(needsRehash('$2b$10$somethingbcryptish')).toBe(true)
  })

  it('is false for no hash at all, which is not a hash to upgrade', () => {
    expect(needsRehash(null)).toBe(false)
  })
})

describe('the password policy', () => {
  it('asks for length rather than punctuation', () => {
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(12)
  })
})
