import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { gatePassphrase, gateToken, safeNext, tokensMatch } from '@/lib/demo-gate'

const SECRET = 'a-secret-that-is-at-least-thirty-two-characters'

afterEach(() => {
  delete process.env.ARC_DEMO_PASSPHRASE
})

describe('gatePassphrase', () => {
  it('is off unless a passphrase is configured', () => {
    expect(gatePassphrase()).toBeUndefined()
  })

  it('treats an empty value as off, so a blank Vercel variable cannot lock everyone out', () => {
    process.env.ARC_DEMO_PASSPHRASE = ''
    expect(gatePassphrase()).toBeUndefined()
  })

  it('reads the configured passphrase', () => {
    process.env.ARC_DEMO_PASSPHRASE = 'olas'
    expect(gatePassphrase()).toBe('olas')
  })
})

describe('gateToken', () => {
  it('never contains the passphrase', async () => {
    const token = await gateToken('olas-verdes', SECRET)
    expect(token).not.toContain('olas')
  })

  it('is a base64url HMAC-SHA256, so middleware and the action agree', async () => {
    const token = await gateToken('olas-verdes', SECRET)
    const reference = createHmac('sha256', SECRET)
      .update('demo-gate:olas-verdes')
      .digest('base64url')
    expect(token).toBe(reference)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('changes with the passphrase and with the key', async () => {
    const base = await gateToken('olas-verdes', SECRET)
    expect(await gateToken('olas-verde', SECRET)).not.toBe(base)
    expect(await gateToken('olas-verdes', `${SECRET}!`)).not.toBe(base)
  })
})

describe('tokensMatch', () => {
  it('accepts an exact match and rejects everything else', async () => {
    const token = await gateToken('olas-verdes', SECRET)
    expect(tokensMatch(token, token)).toBe(true)
    expect(tokensMatch(await gateToken('wrong', SECRET), token)).toBe(false)
    expect(tokensMatch(undefined, token)).toBe(false)
    expect(tokensMatch('', token)).toBe(false)
    expect(tokensMatch(token.slice(0, -1), token)).toBe(false)
    expect(tokensMatch(`${token}x`, token)).toBe(false)
  })
})

describe('safeNext', () => {
  it('keeps same-origin paths', () => {
    expect(safeNext('/owner')).toBe('/owner')
    expect(safeNext('/g/abc?day=2026-10-20')).toBe('/g/abc?day=2026-10-20')
  })

  it('refuses anything that would leave the origin', () => {
    expect(safeNext('//evil.example')).toBe('/')
    expect(safeNext('https://evil.example')).toBe('/')
    expect(safeNext('owner')).toBe('/')
    expect(safeNext(null)).toBe('/')
    expect(safeNext(undefined)).toBe('/')
    expect(safeNext('')).toBe('/')
  })
})
