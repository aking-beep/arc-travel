import { prisma } from '@/lib/db'
import { TransportMode } from '@/lib/prisma-types'

/**
 * Travel times between places.
 *
 * The POC reads a seeded matrix rather than calling a routing API: a fixed
 * table makes itinerary feasibility reproducible in tests, and the numbers a
 * local would quote are more honest for a town this size than a routing
 * engine's optimism. `MAPS_PROVIDER` switches the implementation later —
 * everything downstream depends only on `TravelEstimate`.
 */
export interface TravelEstimate {
  fromPlaceId: string
  toPlaceId: string
  mode: TransportMode
  minutes: number
  costMinor: number
  currency: string
  /** True when no edge existed and a conservative default was used. */
  isFallback: boolean
}

/** Used when two places have no declared edge. Deliberately pessimistic. */
export const FALLBACK_MINUTES = 30
export const FALLBACK_COST_MINOR = 12_000

export type TravelMatrix = {
  /** Best estimate across all modes, or filtered to the guest's preferences. */
  get(fromPlaceId: string, toPlaceId: string): TravelEstimate
  all(fromPlaceId: string, toPlaceId: string): TravelEstimate[]
}

export async function loadTravelMatrix(options: {
  placeIds: string[]
  /** Guest's preferred modes. Empty means consider every mode. */
  preferredModes?: TransportMode[]
}): Promise<TravelMatrix> {
  const { placeIds } = options
  const preferred = options.preferredModes ?? []

  const edges =
    placeIds.length === 0
      ? []
      : await prisma.travelEdge.findMany({
          where: { fromPlaceId: { in: placeIds }, toPlaceId: { in: placeIds } },
          select: {
            fromPlaceId: true,
            toPlaceId: true,
            mode: true,
            minutes: true,
            typicalCostMinor: true,
            currency: true,
          },
        })

  const byPair = new Map<string, TravelEstimate[]>()
  for (const edge of edges) {
    const key = `${edge.fromPlaceId}:${edge.toPlaceId}`
    const list = byPair.get(key) ?? []
    list.push({
      fromPlaceId: edge.fromPlaceId,
      toPlaceId: edge.toPlaceId,
      mode: edge.mode,
      minutes: edge.minutes,
      costMinor: edge.typicalCostMinor,
      currency: edge.currency,
      isFallback: false,
    })
    byPair.set(key, list)
  }

  const fallback = (from: string, to: string): TravelEstimate => ({
    fromPlaceId: from,
    toPlaceId: to,
    mode: TransportMode.TAXI,
    minutes: FALLBACK_MINUTES,
    costMinor: FALLBACK_COST_MINOR,
    currency: 'MXN',
    isFallback: true,
  })

  const all = (from: string, to: string): TravelEstimate[] => {
    if (from === to) {
      return [
        {
          fromPlaceId: from,
          toPlaceId: to,
          mode: TransportMode.WALK,
          minutes: 0,
          costMinor: 0,
          currency: 'MXN',
          isFallback: false,
        },
      ]
    }
    return byPair.get(`${from}:${to}`) ?? [fallback(from, to)]
  }

  const get = (from: string, to: string): TravelEstimate => {
    const options = all(from, to)

    // Prefer a mode the guest actually said they would use. Walking only counts
    // as preferred if they asked for it: a 25-minute walk in 32°C is not the
    // same product as a taxi, and treating it as interchangeable is how an
    // itinerary ends up technically feasible and actually miserable.
    const inPreference =
      preferred.length > 0 ? options.filter((o) => preferred.includes(o.mode)) : options

    const pool = inPreference.length > 0 ? inPreference : options
    return pool.reduce<TravelEstimate>(
      (best, option) => (option.minutes < best.minutes ? option : best),
      pool[0] as TravelEstimate,
    )
  }

  return { all, get }
}
