import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { isAppError } from '@/lib/errors'
import {
  canonicalJson,
  changed,
  hashesDiffer,
  snapshotHash,
  snapshotOf,
} from '@/modules/culture-context/hash'

/**
 * Snapshot hashing.
 *
 * The first block ports culture-context's three hash test files. The second
 * pins the fix: one canonical function, so the paths that used to disagree
 * (API vs ingestion CLI) cannot.
 */
describe('ported from test_change.py', () => {
  it('snapshot change detection is deterministic', () => {
    const a = snapshotOf('gov:jp', 'one')
    const b = snapshotOf('gov:jp', 'one')
    const c = snapshotOf('gov:jp', 'two')
    expect(changed(a, b)).toBe(false)
    expect(changed(a, c)).toBe(true)
  })

  it('comparison requires the same source', () => {
    expect(() => changed(snapshotOf('a', 'x'), snapshotOf('b', 'x'))).toThrow()
    try {
      changed(snapshotOf('a', 'x'), snapshotOf('b', 'x'))
    } catch (error) {
      expect(isAppError(error)).toBe(true)
    }
  })
})

describe('ported from test_stable_text.py', () => {
  it('canonical text is key-order independent', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }))
  })
})

describe('ported from test_worker_change.py', () => {
  it('detects hash inequality', () => {
    expect(hashesDiffer('a', 'b')).toBe(true)
    expect(hashesDiffer('a', 'a')).toBe(false)
  })

  it('refuses to compare a missing hash', () => {
    expect(() => hashesDiffer('', 'a')).toThrow()
    expect(() => hashesDiffer('a', '')).toThrow()
  })
})

describe('one canonical hash (API vs CLI divergence fix)', () => {
  // The same payload as the API path (default separators) and the CLI path
  // (compact separators) would have serialised it. Both used to hash
  // differently; parsed back to a value, they must hash identically now.
  const apiStyle = '{"a": 1, "b": {"d": [1, 2], "c": "x"}}'
  const cliStyle = '{"b":{"c":"x","d":[1,2]},"a":1}'

  it('gives one hash for one value, whatever its serialisation or key order', () => {
    expect(snapshotHash(JSON.parse(apiStyle))).toBe(snapshotHash(JSON.parse(cliStyle)))
  })

  it('is SHA-256 over compact, sorted JSON', () => {
    const expected = createHash('sha256').update('{"a":1,"b":{"c":"x","d":[1,2]}}').digest('hex')
    expect(snapshotHash(JSON.parse(apiStyle))).toBe(expected)
  })

  it('sorts nested keys and keeps array order', () => {
    expect(canonicalJson({ z: [{ b: 1, a: 2 }], y: null })).toBe('{"y":null,"z":[{"a":2,"b":1}]}')
    expect(snapshotHash([1, 2])).not.toBe(snapshotHash([2, 1]))
  })

  it('treats a missing key and an undefined key as the same content', () => {
    expect(snapshotHash({ a: 1, b: undefined })).toBe(snapshotHash({ a: 1 }))
  })

  it('refuses values JSON cannot represent rather than coercing them', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow()
    expect(() => canonicalJson({ a: () => 1 })).toThrow()
  })

  it('keeps non-ASCII text intact, so an accent change is a change', () => {
    expect(snapshotHash({ t: 'México' })).not.toBe(snapshotHash({ t: 'Mexico' }))
  })
})
