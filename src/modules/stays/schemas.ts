import { z } from 'zod'
import { Locale, StayStatus } from '@/lib/prisma-types'

/**
 * Front-desk input: the guest and the stay that gives them a portal.
 *
 * Parsed by the service, not the action.
 */
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')

export const stayInputSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name?').max(80),
    lastName: z.string().trim().min(1, 'Last name?').max(80),
    email: z.string().trim().toLowerCase().email('Enter a valid email.').max(254),
    phone: z.string().trim().max(40).nullish(),
    locale: z.nativeEnum(Locale).default(Locale.EN),
    countryCode: z.string().trim().toUpperCase().length(2).nullish(),

    checkIn: dateKey,
    checkOut: dateKey,
    adults: z.coerce.number().int().min(1).max(12),
    children: z.coerce.number().int().min(0).max(12).default(0),
    roomTypeId: z.string().uuid().nullish(),
    /** Room revenue for the stay, in pesos at the form edge. */
    roomRevenueMinor: z.coerce.number().int().min(0).max(100_000_000).default(0),
    arrivalNotes: z.string().trim().max(500).nullish(),
  })
  .refine((v) => v.checkOut > v.checkIn, {
    path: ['checkOut'],
    message: 'Check-out must be after check-in.',
  })

export const stayStatusSchema = z.object({
  stayId: z.string().uuid(),
  status: z.nativeEnum(StayStatus),
})

export type StayInput = z.infer<typeof stayInputSchema>
