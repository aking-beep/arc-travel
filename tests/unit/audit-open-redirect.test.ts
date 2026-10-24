import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { safeNext } from '@/lib/demo-gate'

/**
 * AUDIT-4 — `?next=` must be narrowed to a same-origin path everywhere.
 *
 * `safeNext` exists for exactly this and is applied by the demo gate. Two
 * places did not use it:
 *
 *   * `src/app/sign-in/page.tsx` narrowed with `next.startsWith('/')`, which
 *     admits a protocol-relative `//evil.example.com` — confirmed live: opening
 *     `/sign-in?next=//example.com/pwned` rendered that value into the form and
 *     submitting it navigated the browser to `http://example.com/pwned`.
 *   * `setLocaleAction` and `signInAction` in `src/app/actions.ts` pass the
 *     posted `next` straight to `redirect()` with no narrowing at all.
 *
 * Both call sites now route through `safeNext`. These tests pin the helper's
 * contract, including the backslash form, and assert that no second, weaker
 * narrowing has reappeared beside it.
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

describe('a backslash in the authority position', () => {
  it('is refused, because browsers normalise it to a slash', () => {
    expect(safeNext('/\\example.com/pwned')).toBe('/')
    expect(safeNext('\\\\example.com')).toBe('/')
  })
})

/**
 * A source-level guard. The defect was never that `safeNext` was wrong; it was
 * that two call sites did not use it. A unit test cannot reach a server action
 * or a Server Component's redirect, so this asserts the call sites directly.
 */
describe('every ?next= call site uses safeNext', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

  it('narrows in the server actions', () => {
    const source = read('src/app/actions.ts')
    expect(source).toContain("safeNext(String(formData.get('next') ?? '/'))")
    expect(source).not.toMatch(/redirect\(String\(formData/)
  })

  it('narrows on the sign-in page', () => {
    const source = read('src/app/sign-in/page.tsx')
    expect(source).toContain('safeNext(next)')
    expect(source).not.toContain("next.startsWith('/')")
  })
})
