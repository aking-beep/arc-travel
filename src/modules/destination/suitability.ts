import { prisma } from '@/lib/db'
import { notFound, safetyConstraint } from '@/lib/errors'
import { type AbilityLevel } from '@/lib/prisma-types'
import { toLocalDateKey } from '@/lib/dates'
import {
  abilityRank,
  gateByConditions,
  getConditions,
  type ConditionsGate,
  type ConditionsSnapshot,
} from './conditions'

/**
 * Single-slot suitability.
 *
 * The itinerary pipeline gates a whole candidate set at once
 * (`modules/itinerary/service.collectCandidates`). This is the same gate for
 * one departure, and it exists because the itinerary was not the only way to
 * reach a booking: a guest could open an experience page directly, or add a
 * slot to their basket, and neither path consulted the gate at all. A beginner
 * could put the advanced-only Zicatela session in their basket and pay for it.
 *
 * So this is the chokepoint for "may this guest book this departure": the
 * experience page renders from it, and `addToCart` refuses on it. It is
 * evaluated at the moment of the request rather than read from the itinerary,
 * so a conditions report entered overnight changes the answer before the guest
 * can book on it.
 */
export interface SlotSuitability {
  slotId: string
  experienceId: string
  allowed: boolean
  /** Machine-readable exclusion codes. Empty when allowed. */
  exclusions: string[]
  /** Guest-facing sentences, shown whether allowed or not. */
  notes: string[]
  snapshot: ConditionsSnapshot | null
  usedBaseline: boolean
  /** The ability the guest stated, or null if they declined to. */
  guestAbility: AbilityLevel | null
}

export async function evaluateSlotForGuest(options: {
  guestId: string
  slotId: string
  now?: Date
}): Promise<SlotSuitability> {
  const now = options.now ?? new Date()

  const [guest, slot] = await Promise.all([
    prisma.guest.findUnique({
      where: { id: options.guestId },
      select: {
        id: true,
        propertyId: true,
        surfAbility: true,
        partySize: true,
      },
    }),
    prisma.availabilitySlot.findUnique({
      where: { id: options.slotId },
      select: {
        id: true,
        startsAt: true,
        experience: {
          select: {
            id: true,
            propertyId: true,
            guideIncluded: true,
            minAbility: true,
            placeId: true,
            place: { select: { id: true, typicalRisk: true } },
            activity: {
              select: {
                minAbility: true,
                maxSafeRisk: true,
                guideRequired: true,
                conditionsSensitive: true,
                placeId: true,
                place: { select: { id: true, typicalRisk: true } },
              },
            },
          },
        },
      },
    }),
  ])

  if (!guest) throw notFound('Guest')
  if (!slot) throw notFound('Departure')

  // Tenant check: a slot from another property is not merely unsuitable, it is
  // not visible.
  if (slot.experience.propertyId !== guest.propertyId) throw notFound('Departure')

  const experience = slot.experience
  const activity = experience.activity

  // The experience's own place wins; the activity's is the fallback. Without
  // either, a conditions-sensitive candidate cannot be judged at all.
  const place = experience.place ?? activity.place
  const forDate = toLocalDateKey(slot.startsAt)

  const snapshot = place
    ? (await getConditions([place.id], [forDate], now)).get(`${place.id}:${forDate}`) ?? null
    : null

  const gate: ConditionsGate = gateByConditions({
    guestAbility: guest.surfAbility,
    activityMaxSafeRisk: activity.maxSafeRisk,
    // The stricter of the activity's floor and the experience's own. Compared
    // by rank, not by string: enum names do not sort by ability level.
    activityMinAbility:
      abilityRank(activity.minAbility) > abilityRank(experience.minAbility)
        ? activity.minAbility
        : experience.minAbility,
    activityGuideRequired: activity.guideRequired,
    experienceGuideIncluded: experience.guideIncluded,
    snapshot,
    placeBaselineRisk: place?.typicalRisk ?? null,
    conditionsSensitive: activity.conditionsSensitive,
    hasLocation: activity.conditionsSensitive ? Boolean(place) : true,
  })

  return {
    slotId: slot.id,
    experienceId: experience.id,
    allowed: gate.allowed,
    exclusions: gate.exclusions,
    notes: gate.notes,
    snapshot: gate.snapshot,
    usedBaseline: gate.usedBaseline,
    guestAbility: guest.surfAbility,
  }
}

/**
 * Throws unless the guest may book this departure.
 *
 * Used by `addToCart`, so suitability is enforced at the point of commitment
 * and not only at the point of recommendation. The message names the reason,
 * because "unavailable" to a guest who can see the departure listed is worse
 * than no answer.
 */
export async function assertSlotSuitableForGuest(options: {
  guestId: string
  slotId: string
  now?: Date
}): Promise<SlotSuitability> {
  const suitability = await evaluateSlotForGuest(options)

  if (!suitability.allowed) {
    throw safetyConstraint(
      suitability.notes[0] ??
        'This departure is not suitable for you on that date, so it cannot be booked.',
      { exclusions: suitability.exclusions, notes: suitability.notes },
    )
  }

  return suitability
}

/** Batch variant for a list page. Never throws; returns one entry per slot. */
export async function evaluateSlotsForGuest(options: {
  guestId: string
  slotIds: string[]
  now?: Date
}): Promise<Map<string, SlotSuitability>> {
  const out = new Map<string, SlotSuitability>()
  for (const slotId of options.slotIds) {
    try {
      out.set(slotId, await evaluateSlotForGuest({ ...options, slotId }))
    } catch {
      // A slot that cannot be resolved is simply absent from the map, and the
      // caller renders it as unbookable.
      continue
    }
  }
  return out
}
