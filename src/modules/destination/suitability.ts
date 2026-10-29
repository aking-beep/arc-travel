import { prisma } from '@/lib/db'
import { notFound, safetyConstraint } from '@/lib/errors'
import { type AbilityLevel } from '@/lib/prisma-types'
import { toLocalDateKey, toLocalTimeString } from '@/lib/dates'
import { gateByOperatingWindow } from './operating-window'
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
  /**
   * The subset of `notes` that are reasons for the refusal. Empty when
   * allowed. A caller greying out a departure wants this, not `notes[0]`,
   * which may be a caveat that is true of an allowed departure too.
   */
  blockers: string[]
  snapshot: ConditionsSnapshot | null
  usedBaseline: boolean
  /** The ability the guest stated, or null if they declined to. */
  guestAbility: AbilityLevel | null
}

/**
 * Who is asking, reduced to the two facts the gate needs.
 *
 * The gate never needed a `Guest` row — it needed the property the person is
 * shopping in, and the ability they stated. Naming that separately is what
 * lets a visitor who has not signed up yet be gated by exactly the same rules:
 * a pre-account basket states no ability, which is the ADR-017 case the gate
 * already handles conservatively, rather than a case where the gate is skipped.
 */
export interface SlotAudience {
  /** The property they are shopping in. A slot elsewhere is not visible. */
  propertyId: string
  /** The ability they stated, or null when they have stated none. */
  surfAbility: AbilityLevel | null
}

export async function evaluateSlotForGuest(options: {
  guestId: string
  slotId: string
  now?: Date
}): Promise<SlotSuitability> {
  const guest = await prisma.guest.findUnique({
    where: { id: options.guestId },
    select: { id: true, propertyId: true, surfAbility: true },
  })
  if (!guest) throw notFound('Guest')

  return evaluateSlotForAudience({
    audience: { propertyId: guest.propertyId, surfAbility: guest.surfAbility },
    slotId: options.slotId,
    now: options.now,
  })
}

/**
 * The gate itself, for anyone who may be holding a basket.
 *
 * `evaluateSlotForGuest` is this with a `Guest` row read first. A basket that
 * has no guest behind it yet — somebody buying from the public storefront
 * before they have an account — reaches the same rules through here.
 */
export async function evaluateSlotForAudience(options: {
  audience: SlotAudience
  slotId: string
  now?: Date
}): Promise<SlotSuitability> {
  const now = options.now ?? new Date()

  const slot = await prisma.availabilitySlot.findUnique({
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
                earliestStart: true,
                latestStart: true,
                seasonMonths: true,
                placeId: true,
                place: { select: { id: true, typicalRisk: true } },
              },
            },
          },
        },
      },
  })

  if (!slot) throw notFound('Departure')

  // Tenant check: a slot from another property is not merely unsuitable, it is
  // not visible.
  if (slot.experience.propertyId !== options.audience.propertyId) throw notFound('Departure')

  const experience = slot.experience
  const activity = experience.activity

  // The experience's own place wins; the activity's is the fallback. Without
  // either, a conditions-sensitive candidate cannot be judged at all.
  const place = experience.place ?? activity.place
  const forDate = toLocalDateKey(slot.startsAt)

  const snapshot = place
    ? (await getConditions([place.id], [forDate], now)).get(`${place.id}:${forDate}`) ?? null
    : null

  /**
   * The activity's operating window, gated here as well as in `scoreCandidate`.
   * Not recommended must mean not sellable: a dawn-only session listed at 23:00
   * was excluded from every itinerary and still purchasable from the experience
   * page until this gate existed.
   */
  const window = gateByOperatingWindow({
    window: {
      earliestStart: activity.earliestStart,
      latestStart: activity.latestStart,
      seasonMonths: activity.seasonMonths,
    },
    startTime: toLocalTimeString(slot.startsAt),
    forDate,
  })

  const gate: ConditionsGate = gateByConditions({
    guestAbility: options.audience.surfAbility,
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
    allowed: gate.allowed && window.allowed,
    exclusions: [...gate.exclusions, ...window.exclusions],
    notes: [...gate.notes, ...window.notes],
    // Every note the operating-window gate produces is a refusal; the
    // conditions gate's are a mix, which is what `blockers` separates.
    blockers: [...gate.blockers, ...window.notes],
    snapshot: gate.snapshot,
    usedBaseline: gate.usedBaseline,
    guestAbility: options.audience.surfAbility,
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
  return refuseUnlessAllowed(await evaluateSlotForGuest(options))
}

/**
 * The same refusal for a basket that has no guest behind it yet.
 *
 * `addToCart` used to run the gate only `if (cart.guestId)`, which was true of
 * every basket the product could then produce. A public storefront basket is
 * not, and leaving that condition in place would have made "sign up after you
 * pay" the one route to a booking the conditions gate never saw.
 */
export async function assertSlotSuitableForAudience(options: {
  audience: SlotAudience
  slotId: string
  now?: Date
}): Promise<SlotSuitability> {
  return refuseUnlessAllowed(await evaluateSlotForAudience(options))
}

function refuseUnlessAllowed(suitability: SlotSuitability): SlotSuitability {
  if (!suitability.allowed) {
    throw safetyConstraint(
      suitability.blockers[0] ??
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

/** The audience equivalent, for the public storefront's departure list. */
export async function evaluateSlotsForAudience(options: {
  audience: SlotAudience
  slotIds: string[]
  now?: Date
}): Promise<Map<string, SlotSuitability>> {
  const out = new Map<string, SlotSuitability>()
  for (const slotId of options.slotIds) {
    try {
      out.set(slotId, await evaluateSlotForAudience({ ...options, slotId }))
    } catch {
      continue
    }
  }
  return out
}
