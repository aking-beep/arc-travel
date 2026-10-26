import { z } from 'zod'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/password-policy'

/**
 * Guest account input.
 *
 * Parsed by the service, not by the action, so a service is the thing that may
 * be trusted to have validated its input.
 */
const email = z.string().trim().toLowerCase().min(3).max(254).email('Enter your email address.')

const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH)

/**
 * A booking reference as the guest reads it off a confirmation.
 *
 * Upper-cased and stripped of whitespace, because a reference that fails
 * because it was pasted with a space is a support ticket, not a security
 * control — `referenceCandidates` in `./account.ts` goes on to accept it with
 * or without its hyphens. What makes the claim safe is that the reference has
 * to arrive together with the address the property recorded, not that it is
 * hard to type.
 */
const reference = z
  .string()
  .trim()
  .toUpperCase()
  .transform((value) => value.replace(/\s+/g, ''))
  .pipe(
    z
      .string()
      .min(4, 'Enter the booking reference from your confirmation.')
      .max(32)
      .regex(/^[A-Z0-9-]+$/, 'A booking reference is letters, numbers and dashes only.'),
  )

/** Sign up and claim the first booking in one submission. */
export const guestSignUpSchema = z
  .object({
    name: z.string().trim().min(2, 'Tell us your name.').max(120),
    email,
    reference,
    password,
    confirmPassword: z.string(),
    acceptedTerms: z.coerce.boolean(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two passwords do not match.',
  })
  .refine((v) => v.acceptedTerms, {
    path: ['acceptedTerms'],
    message: 'Accept the terms to continue.',
  })

/** Add a further booking to an account that already exists. */
export const claimStaySchema = z.object({
  reference,
  /**
   * Optional on this form: an account holder has already proved one booking,
   * and the service falls back to the address on their account. It is still
   * accepted because a hotel may hold a different address for them than the
   * one they signed up with.
   */
  email: email.optional(),
})

/**
 * Sign up from inside the portal.
 *
 * No reference and no address: the person is holding the token, which is
 * already the proof of the booking, and the address is the one the property
 * recorded. Asking them to retype either would be asking them to prove
 * something they have just proved, and putting an email in a query string to
 * prefill it would put it in every log between here and the browser.
 */
export const portalAccountSignUpSchema = z
  .object({
    name: z.string().trim().min(2, 'Tell us your name.').max(120),
    password,
    confirmPassword: z.string(),
    acceptedTerms: z.coerce.boolean(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two passwords do not match.',
  })
  .refine((v) => v.acceptedTerms, {
    path: ['acceptedTerms'],
    message: 'Accept the terms to continue.',
  })

export type GuestSignUpInput = z.infer<typeof guestSignUpSchema>
export type PortalAccountSignUpInput = z.infer<typeof portalAccountSignUpSchema>
export type ClaimStayInput = z.infer<typeof claimStaySchema>

/**
 * A direct trip: experiences without a room (ADR-042).
 *
 * The dates are the trip window, not a reservation. They exist because the
 * whole guest surface reasons about days — the conditions gate, the itinerary,
 * travel times, what is bookable — and a person planning "two days here" is
 * giving the only input any of that needs.
 */
export const directTripSchema = z
  .object({
    name: z.string().trim().min(2, 'Tell us your name.').max(120),
    email,
    propertySlug: z
      .string()
      .trim()
      .min(1, 'Choose where you want to book through.')
      .max(120),
    fromDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
    toDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
    partySize: z.coerce.number().int().min(1, 'At least one person.').max(12),
    password,
    confirmPassword: z.string(),
    acceptedTerms: z.coerce.boolean(),
  })
  .strict()
  .refine((v) => v.toDate >= v.fromDate, {
    path: ['toDate'],
    message: 'The last day cannot be before the first.',
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two passwords do not match.',
  })
  .refine((v) => v.acceptedTerms, {
    path: ['acceptedTerms'],
    message: 'Accept the terms to continue.',
  })

export type DirectTripInput = z.infer<typeof directTripSchema>

/** A further trip, added from an account that already exists. */
export const additionalTripSchema = z
  .object({
    propertySlug: z.string().trim().min(1, 'Choose where you want to book through.').max(120),
    fromDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
    toDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
    partySize: z.coerce.number().int().min(1).max(12),
  })
  .strict()
  .refine((v) => v.toDate >= v.fromDate, {
    path: ['toDate'],
    message: 'The last day cannot be before the first.',
  })
