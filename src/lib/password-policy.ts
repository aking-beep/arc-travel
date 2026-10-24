/**
 * The password policy, in a module a client component may import.
 *
 * `src/lib/password.ts` needs `node:crypto`, which cannot be bundled for the
 * browser — and a sign-up form has to be able to tell someone the minimum
 * length before they submit. So the numbers live here and the hashing imports
 * them, rather than a form importing the hashing.
 *
 * Length over composition: a 12-character minimum with no character-class
 * rules, which is what current guidance says and what people actually comply
 * with. The upper bound exists because scrypt hashes whatever it is given and a
 * megabyte-long password is a denial of service.
 */
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 200
