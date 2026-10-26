import { createHmac } from 'node:crypto'

import { LOCAL_SEED_TOKEN_SECRET } from './env'

/**
 * The seeded demo guests' portal tokens.
 *
 * ## Why these are not literals any more
 *
 * They used to be `demo-portal-01` through `demo-portal-06`, written into
 * `prisma/seed.ts`. A portal token is a bearer credential: `resolvePortalContext`
 * takes it and returns a guest, and the holder can then change that guest's
 * preferences, add to their basket and cancel their bookings. So anyone who had
 * read the repository — which is to say anyone — could open a hosted demo's
 * guest portals and act as those guests.
 *
 * The other seeded stays were no better. Their tokens came from a `mulberry32`
 * PRNG with the literal seed `20_251_020` next to it in the same directory, so
 * they were reproducible by anyone who cloned the project and ran it.
 *
 * ## Deterministic and unguessable are not in conflict
 *
 * The fixtures have to stay reproducible — Playwright specs assert on them and
 * demo screenshots have to keep working — so the tokens cannot simply be
 * random. They are an HMAC instead: deterministic given the secret, and not
 * derivable without it. A deployment that sets `ARC_SEED_TOKEN_SECRET` gets
 * tokens nobody else can compute; this repository contains no value that
 * produces them.
 *
 * Local development and the test suites get the fallback below, deliberately,
 * so `npm run setup` works on a clean checkout. It is not a secret and is not
 * treated as one: `src/lib/env.ts` refuses to start in production without a
 * real `ARC_SEED_TOKEN_SECRET`.
 */
export { LOCAL_SEED_TOKEN_SECRET } from './env'

/** How many of the seeded stays are reachable from the demo index. */
export const DEMO_PORTAL_COUNT = 6

/**
 * The configured secret, or the local fallback.
 *
 * Read from `process.env` directly rather than through `getEnv()`, because the
 * seed runs this before the application's env contract is parsed, and because
 * `getEnv()` memoises in a way a seed re-run does not want.
 */
export function seedTokenSecret(): string {
  const configured = process.env.ARC_SEED_TOKEN_SECRET
  return configured && configured.length > 0 ? configured : LOCAL_SEED_TOKEN_SECRET
}

/**
 * The portal token for a seeded stay.
 *
 * `label` identifies the stay within the fixture set — `'demo-1'` … `'demo-6'`
 * for the six on the demo index, and `stay-<n>` for the rest. Changing a label
 * changes that stay's token, which is fine: the seed truncates and rewrites.
 *
 * 32 lowercase base32 characters, so the token is the same shape as the ones
 * `src/lib/ids.ts` mints for real stays. Not hex: hex at this length is a
 * recognisable "this is a hash of something" shape, and a portal token should
 * look like an opaque handle because that is all it is.
 */
export function seededPortalToken(label: string, secret = seedTokenSecret()): string {
  const digest = createHmac('sha256', secret).update(`portal-token:${label}`).digest()

  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  let out = ''
  for (let i = 0; i < 32; i += 1) {
    // One character per byte. Wasteful of the digest, and the digest has 32
    // bytes to waste; 32 base32 characters is 160 bits of the 256 available.
    out += alphabet[digest[i]! % alphabet.length]
  }
  return out
}

/**
 * The token for one of the stays the demo index links to, numbered from 1.
 *
 * `src/app/demo/page.tsx` used to find these with
 * `portalToken: { startsWith: 'demo-portal-' }`, which was the only reason the
 * prefix existed. It looks one up by this instead.
 */
export function demoPortalToken(index: number, secret = seedTokenSecret()): string {
  if (!Number.isInteger(index) || index < 1 || index > DEMO_PORTAL_COUNT) {
    throw new Error(`Demo portal index must be 1..${DEMO_PORTAL_COUNT}; got ${String(index)}`)
  }
  return seededPortalToken(`demo-${index}`, secret)
}
