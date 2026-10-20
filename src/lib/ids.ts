import { randomBytes, randomUUID } from 'node:crypto'

/** Unambiguous alphabet: no 0/O/1/I/L, so a reference can be read aloud. */
const READABLE = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export const uuid = (): string => randomUUID()

/** Human-quotable reference, e.g. `ARC-7K4M-QX2P`. */
export function reference(prefix: string, groups = 2, groupSize = 4): string {
  const bytes = randomBytes(groups * groupSize)
  const chars = Array.from(bytes, (b) => READABLE[b % READABLE.length]).join('')
  const parts: string[] = []
  for (let i = 0; i < groups; i += 1) {
    parts.push(chars.slice(i * groupSize, (i + 1) * groupSize))
  }
  return [prefix, ...parts].join('-')
}

export const orderReference = (): string => reference('ARC')
export const stayReference = (): string => reference('STAY')

/** Opaque, URL-safe token for QR-code guest portal links. */
export const portalToken = (): string => randomBytes(24).toString('base64url')
