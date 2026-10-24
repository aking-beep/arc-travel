import { describe, expect, it } from 'vitest'
import { safeNext } from '@/lib/demo-gate'

/**
 * AUDIT-4 — `?next=` must be narrowed to a same-origin path everywhere.
 *
 * `safeNext` exists for exactly this and is applied by the demo gate. Two
 * places do not use it:
 *
 *   * `src/app/sign-in/page.tsx` narrows with `next.startsWith('/')`, which
 *     admits a protocol-relative `//evil.example.com` — confirmed live: opening
 *     `/sign-in?next=//example.com/pwned` renders that value into the form and
 *     submitting it navigates the browser to `http://example.com/pwned`.
 *   * `setLocaleAction` and `signInAction` in `src/app/actions.ts` pass the
 *     posted `next` straight to `redirect()` with no narrowing at all.
 *
 * These tests pin the helper's contract and the cases the sign-in check misses.
 * The fix is to route both call sites through `safeNext`.
 */
describe('safeNext', () => {
  it('keeps an ordinary same-origin path', () => {
    expect(safeNext('/owner/revenue')).toBe('/owner/revenue')
    expect(safeNext('/g/abc?tab=basket')).toBe('/g/abc?tab=basket')
  })

  it('rejects an absolute URL', () => {
    expect(safeNext('https://example.com/pwned')).toBe('/')
    expect(safeNext('http://example.com/pwned')).toBe('/')
  })

  it('rejects a protocol-relative URL, which startsWith("/") admits', () => {
    expect(safeNext('//example.com/pwned')).toBe('/')
  })

  it('rejects empty and missing values', () => {
    expect(safeNext('')).toBe('/')
    expect(safeNext(null)).toBe('/')
    expect(safeNext(undefined)).toBe('/')
  })
})

/**
 * The check the sign-in page actually performs, reproduced here so the gap is
 * visible rather than inferred. This test documents the defect: it passes only
 * while the page's narrowing is weaker than `safeNext`.
 */
const signInPageNarrowing = (next: string | undefined): string =>
  next && next.startsWith('/') ? next : '/'

describe('the sign-in page’s own narrowing', () => {
  it('admits a protocol-relative URL that safeNext refuses', () => {
    expect(signInPageNarrowing('//example.com/pwned')).toBe('//example.com/pwned')
    expect(safeNext('//example.com/pwned')).toBe('/')
  })

  it('should agree with safeNext on every input', () => {
    for (const candidate of [
      '/owner',
      '//example.com/pwned',
      'https://example.com',
      '\\\\example.com',
      '',
    ]) {
      expect(signInPageNarrowing(candidate)).toBe(safeNext(candidate))
    }
  })
})
