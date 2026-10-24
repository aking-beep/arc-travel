import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

/**
 * Password hashing, on `node:crypto` alone.
 *
 * scrypt rather than bcrypt or argon2 because both of those are native
 * modules, and this product's dependency list is short on purpose: a
 * memory-hard KDF that ships with the runtime is worth more than a marginally
 * better one that adds a build toolchain. The parameters below are the
 * interactive-login set from the scrypt paper's own guidance (N=2^15, r=8,
 * p=1), which costs ~32 MB and ~100 ms per verification.
 *
 * The stored form carries its own parameters, so raising the cost later does
 * not invalidate existing hashes: `verifyPassword` reads N, r and p from the
 * string it is checking against, and `needsRehash` says when a hash was made
 * with weaker ones.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const
const KEY_LENGTH = 64
const SALT_LENGTH = 16
/** scrypt needs roughly 128 · N · r bytes; give it headroom. */
const MAXMEM = 192 * 1024 * 1024

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: MAXMEM,
  })
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$')
}

/**
 * Constant-time verification.
 *
 * Returns false for a malformed or absent hash rather than throwing: a user row
 * with no password is an account that cannot sign in with one, which is a
 * refusal, not an error. Callers must still not reveal which of the two it was.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false

  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, nRaw, rRaw, pRaw, saltRaw, keyRaw] = parts
  const N = Number(nRaw)
  const r = Number(rRaw)
  const p = Number(pRaw)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  // A hash claiming absurd parameters is a denial-of-service vector, not a
  // stronger hash.
  if (N > 2 ** 20 || r > 32 || p > 16) return false

  let expected: Buffer
  let actual: Buffer
  try {
    expected = Buffer.from(keyRaw!, 'base64url')
    actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltRaw!, 'base64url'), expected.length, {
      N,
      r,
      p,
      maxmem: MAXMEM,
    })
  } catch {
    return false
  }

  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

/** True when `stored` was made with weaker parameters than we now use. */
export function needsRehash(stored: string | null | undefined): boolean {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true
  return Number(parts[1]) < PARAMS.N || Number(parts[2]) < PARAMS.r
}

// The policy lives in `password-policy.ts`, which a client component may
// import; this module cannot be bundled for the browser.
export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password-policy'
