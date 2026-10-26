import { z } from 'zod'
import { Locale } from '@/lib/prisma-types'

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex colour, e.g. #1F3A34.')

export const propertyProfileSchema = z.object({
  name: z.string().trim().min(2, 'The property needs a name.').max(120),
  tagline: z.string().trim().max(160).nullish(),
  description: z.string().trim().max(4000).nullish(),
  houseNotes: z.string().trim().max(4000).nullish(),
  checkInTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.'),
  checkOutTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.'),
  defaultLocale: z.enum(Locale),
  brandPrimary: hexColor,
  brandAccent: hexColor,
  placeId: z.string().uuid().nullish(),
  contactEmail: z.string().trim().email('Enter a valid email.').nullish().or(z.literal('')),
  contactPhone: z.string().trim().max(40).nullish(),
})

export type PropertyProfileInput = z.infer<typeof propertyProfileSchema>

export const roomTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(16)
    .regex(/^[A-Z0-9_-]+$/, 'Use uppercase letters, numbers, dash or underscore.'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(600).nullish(),
  maxOccupancy: z.coerce.number().int().min(1).max(12),
  roomCount: z.coerce.number().int().min(1).max(200),
  /** Nightly rate in minor units. */
  baseRateMinor: z.coerce.number().int().min(0).max(100_000_000),
})

export const amenitySchema = z.object({
  name: z.string().trim().min(2).max(80),
  category: z.enum(['SURF', 'WELLNESS', 'ADVENTURE', 'DINING', 'TRANSPORT', 'CULTURE']),
  description: z.string().trim().max(600).nullish(),
  isIncluded: z.coerce.boolean().default(true),
})

export const partnerInviteSchema = z.object({
  name: z.string().trim().min(2, 'Give the partner a name.').max(120),
  contactName: z.string().trim().min(2).max(120),
  contactEmail: z.string().trim().email('Enter a valid email.'),
  contactPhone: z.string().trim().max(40).nullish(),
  categories: z
    .array(z.enum(['SURF', 'WELLNESS', 'ADVENTURE', 'DINING', 'TRANSPORT', 'CULTURE']))
    .min(1, 'Pick at least one category.'),
  placeId: z.string().uuid().nullish(),
  description: z.string().trim().max(600).nullish(),
  /** Hotel's share of gross, in basis points. */
  hotelCommissionBps: z.coerce.number().int().min(0).max(5000),
  /**
   * Which language to write to this partner in.
   *
   * Asked rather than assumed. The invitation is the first thing ARC ever
   * sends them, it is the only thing standing between them and an account, and
   * in Puerto Escondido the local operator a boutique hotel works with is more
   * likely to read Spanish than English. Defaults to EN to match
   * `User.locale`; the form preselects Spanish, where the destination is.
   */
  contactLocale: z.enum(['EN', 'ES']).default('EN'),
})
