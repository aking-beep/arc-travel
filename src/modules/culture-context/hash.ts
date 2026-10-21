import { createHash } from 'node:crypto'
import { invalid } from '@/lib/errors'

/**
 * The one snapshot hash.
 *
 * culture-context had three. The API hashed `json.dumps(sort_keys=True)` with
 * default separators, the ingestion CLI hashed the same payload with compact
 * separators, and the worker compared whatever strings it was handed. So the
 * same GOV.UK payload got two different hashes depending on which path saw
 * it. Both hashes also covered the whole payload, so a change to volatile
 * metadata produced a new hash and a false change candidate.
 *
 * Here there is one function, and callers hash *content*, not payloads: the
 * GOV.UK adapter passes the normalised section text it extracted, never the
 * raw content item (see `govukSnapshotContent`).
 */

/**
 * Canonical JSON: object keys sorted by code point, no insignificant
 * whitespace, the same output for the same value however it was built.
 *
 * Refuses values JSON cannot represent faithfully (`NaN`, `Infinity`,
 * functions, symbols, bigint) instead of silently coercing them, because a
 * hash over a lossy encoding would call two different values identical.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, '$')
}

function encode(value: unknown, path: string): string {
  if (value === null) return 'null'
  if (value instanceof Date) return JSON.stringify(value.toISOString())

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value)
    case 'number':
      if (!Number.isFinite(value)) throw invalid(`Cannot hash a non-finite number at ${path}.`)
      return JSON.stringify(value)
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((v, i) => (v === undefined ? 'null' : encode(v, `${path}[${i}]`))).join(',')}]`
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${encode(v, `${path}.${k}`)}`).join(',')}}`
    }
    default:
      throw invalid(`Cannot hash a ${typeof value} at ${path}.`)
  }
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** The canonical content hash. Every snapshot in ARC is hashed with this. */
export function snapshotHash(content: unknown): string {
  return sha256Hex(canonicalJson(content))
}

export interface SnapshotDigest {
  sourceKey: string
  contentHash: string
}

export function snapshotOf(sourceKey: string, content: unknown): SnapshotDigest {
  return { sourceKey, contentHash: snapshotHash(content) }
}

/**
 * Whether two snapshots of the *same* source differ.
 *
 * Comparing across sources is a caller bug, not a change, so it throws.
 */
export function changed(previous: SnapshotDigest, current: SnapshotDigest): boolean {
  if (previous.sourceKey !== current.sourceKey) {
    throw invalid('Cannot compare snapshots from different sources.')
  }
  return hashesDiffer(previous.contentHash, current.contentHash)
}

/**
 * Hash inequality, refusing to guess when either side is missing. An absent
 * hash is "we did not get the content", which is neither changed nor unchanged.
 */
export function hashesDiffer(previousHash: string, currentHash: string): boolean {
  if (!previousHash || !currentHash) throw invalid('Both hashes are required.')
  return previousHash !== currentHash
}
