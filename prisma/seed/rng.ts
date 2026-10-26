/**
 * Deterministic PRNG (mulberry32). The seed must produce byte-identical data on
 * every run: demo screenshots, Playwright assertions and the morning briefing
 * all depend on fixed fixtures.
 */
export function createRng(seed: number) {
  let a = seed >>> 0
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    int: (min: number, max: number): number => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('pick() called with an empty list')
      return items[Math.floor(next() * items.length)] as T
    },
    sample: <T>(items: readonly T[], count: number): T[] => {
      const pool = [...items]
      const out: T[] = []
      const n = Math.min(count, pool.length)
      for (let i = 0; i < n; i += 1) {
        const idx = Math.floor(next() * pool.length)
        out.push(pool.splice(idx, 1)[0] as T)
      }
      return out
    },
    bool: (probability = 0.5): boolean => next() < probability,
  }
}

export type Rng = ReturnType<typeof createRng>

/**
 * Deterministic, readable reference generator. Unlike src/lib/ids.ts this is
 * seeded, so `STAY-A4F2` always belongs to the same fixture stay.
 */
const READABLE = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export function seededReference(rng: Rng, prefix: string, length = 4): string {
  let out = ''
  for (let i = 0; i < length; i += 1) out += READABLE[rng.int(0, READABLE.length - 1)]
  return `${prefix}-${out}`
}

/**
 * Deterministic opaque token for fixture identifiers that are *not*
 * credentials — a simulated payment reference, for instance.
 *
 * **Not for a portal token.** It used to mint those, and it should not have:
 * the PRNG seed is a literal in `prisma/seed.ts`, so every token it produced
 * was reproducible by anyone who cloned the repository, and a portal token is a
 * bearer credential. Those come from `src/lib/demo-portals.ts` now, keyed with
 * `ARC_SEED_TOKEN_SECRET`.
 */
export function seededToken(rng: Rng, length = 32): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < length; i += 1) out += alphabet[rng.int(0, alphabet.length - 1)]
  return out
}
