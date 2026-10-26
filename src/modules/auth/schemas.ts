import { z } from 'zod'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/password-policy'

/**
 * Credential and onboarding input.
 *
 * Parsed by the services, not by the actions, so a service is the thing that
 * may be trusted to have validated its input.
 */
const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email('Enter an email address.')

const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH)

export const passwordSignInSchema = z.object({
  email,
  // No minimum on the way in: a sign-in attempt is checked against a stored
  // hash, and telling an attacker that a password was "too short to be ours"
  // is information they did not have.
  password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX_LENGTH),
})

/**
 * Asking for a reset. The address only: there is nothing else to ask for, and
 * anything else on this form would be a thing an attacker gets to vary.
 */
export const passwordResetRequestSchema = z.object({ email })

export const passwordResetCompleteSchema = z
  .object({
    token: z.string().trim().min(16).max(128),
    password,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two passwords do not match.',
  })

export const acceptInvitationSchema = z
  .object({
    token: z.string().trim().min(16).max(128),
    name: z.string().trim().min(2).max(120).optional(),
    password,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two passwords do not match.',
  })

/**
 * Hotel sign-up: the account, the organization and the first property in one
 * submission.
 *
 * One form rather than three, because the three are useless apart: an
 * organization with no property sells nothing, and a property with no owner
 * cannot be reached. `docs/architecture.md` records the layering this respects
 * — the route turns `FormData` into this shape and the service does the rest.
 */
export const organizationSignUpSchema = z
  .object({
    /** The person. */
    name: z.string().trim().min(2, 'Tell us your name.').max(120),
    email,
    password,
    confirmPassword: z.string(),

    /** The business. */
    organizationName: z.string().trim().min(2, 'Name the business.').max(160),
    legalName: z.string().trim().max(200).optional(),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .length(2, 'Use a two-letter country code.')
      .default('MX'),

    /** The first property. */
    propertyName: z.string().trim().min(2, 'Name the property.').max(160),
    propertyTagline: z.string().trim().max(200).optional(),
    currency: z.string().trim().toUpperCase().length(3).default('MXN'),
    contactPhone: z.string().trim().max(40).optional(),

    /** Explicit, recorded and required. */
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

export type PasswordSignInInput = z.infer<typeof passwordSignInSchema>
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>
export type OrganizationSignUpInput = z.infer<typeof organizationSignUpSchema>
