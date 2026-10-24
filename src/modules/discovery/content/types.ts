/**
 * Content types for the illustrative destination set.
 *
 * Ported from the Magic Patterns export. Three changes from the original, each
 * one a CLAUDE.md commitment rather than a preference:
 *
 *   * Every money field is integer minor units and carries `Minor` in its name,
 *     so a float cannot pass as a price (non-negotiable 3). Amounts in this set
 *     are USD, per `CONTENT_CURRENCY`.
 *   * `Verification` became `ListingStatus`, a one-member union (non-negotiable 2).
 *   * `safety` became `hostClaims`: the strings are what an operator says about
 *     its own practice, not an assurance ARC is in a position to give
 *     (non-negotiable 1).
 */

/** Every figure in this content set is USD. Nothing here is a real rate. */
export const CONTENT_CURRENCY = 'USD'

export type TravelStyle = 'Surf & Ocean' | 'Culture & City' | 'Mountain & Alpine' | 'Wellness' | 'Food & Craft' | 'Wild Nature'

export const TRAVEL_STYLES: TravelStyle[] = ['Surf & Ocean', 'Culture & City', 'Mountain & Alpine', 'Wellness', 'Food & Craft', 'Wild Nature']

export type DestinationCategory = 'Coastal' | 'City' | 'Island' | 'Mountain'

export type Neighborhood = { name: string; vibe: string; bestFor: string }

export type ItineraryPreviewDay = { title: string; morning: string; afternoon: string; evening: string }

export type Destination = {
  slug: string
  name: string
  country: string
  region: string
  category: DestinationCategory
  styles: TravelStyle[]
  image: string
  tagline: string
  overview: string[]
  bestTime: string
  timezone: string
  currency: string
  language: string
  airport: string
  dailyFromMinor: number
  featured: boolean
  coords: { x: number; y: number }
  neighborhoods: Neighborhood[]
  itinerary: ItineraryPreviewDay[]
  travelInfo: { label: string; value: string }[]
}

export type PropertyType = 'Boutique Hotel' | 'Design Hotel' | 'Private Villa' | 'Eco Retreat' | 'Surf Lodge' | 'Mountain Lodge' | 'Wellness Retreat'

export const PROPERTY_TYPES: PropertyType[] = ['Boutique Hotel', 'Design Hotel', 'Private Villa', 'Eco Retreat', 'Surf Lodge', 'Mountain Lodge', 'Wellness Retreat']

/**
 * What a listing in this content set is.
 *
 * A one-member union on purpose. The Magic Patterns export shipped
 * `'verified' | 'illustrative'` and marked eight of its hosts `'verified'`,
 * which this product may not do: `/admin` is the only route to a VERIFIED
 * status and fixture partners stay UNVERIFIED (CLAUDE.md non-negotiable 2).
 * Narrowing the type to one member means a future `'verified'` in a content
 * file is a typecheck failure rather than a false claim on a page.
 */
export type ListingStatus = 'illustrative'

/**
 * Where a listing came from.
 *
 * The content set is illustrative throughout. The published catalogue in the
 * database is not: its rows describe a real supplier in Puerto Escondido and
 * carry a real `VerificationStatus` that only `/admin` can set. The two must be
 * distinguishable on the page, because "illustrative" and "unverified" are
 * different claims — the first says nobody is behind this listing, the second
 * says somebody is and ARC has not checked them.
 *
 * Absent means illustrative, so every existing content entry keeps its meaning
 * without being edited.
 */
export type ListingProvenance =
  | { kind: 'illustrative' }
  | { kind: 'live'; verification: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED' }

export type Room = { name: string; sleeps: number; size: string; priceMinor: number; note: string }

export type Property = {
  slug: string
  name: string
  destination: string
  type: PropertyType
  verification: ListingStatus
  /** Empty on a live listing — see `Experience.image`. */
  images: string[]
  pricePerNightMinor: number
  /** Defaults to `CONTENT_CURRENCY`. A live listing is in the property's own currency. */
  currency?: string
  /**
   * Sample figures, labelled as such wherever they appear. Absent on a live
   * listing: a rating nobody left is a commercial signal this product does not
   * get to manufacture, and a real property with no reviews has none.
   */
  rating?: number
  reviews?: number
  provenance?: ListingProvenance
  summary: string
  description: string[]
  amenities: string[]
  rooms: Room[]
  location: string
  highlights: string[]
  checkIn: string
  checkOut: string
}

/**
 * `Transport` is here for the live catalogue, not for the content set.
 *
 * The database's own taxonomy has a TRANSPORT category and nothing in these
 * five buckets it honestly maps to; squeezing an airport transfer into
 * "Nature" to avoid widening a union is how a filter starts lying. The map in
 * `modules/discovery/live.ts` is exhaustive over the Prisma enum, so a new
 * database category fails typecheck rather than landing in whichever bucket
 * was nearest.
 */
export type ExperienceCategory = 'Adventure' | 'Culture' | 'Wellness' | 'Food' | 'Nature' | 'Transport'

export const EXPERIENCE_CATEGORIES: ExperienceCategory[] = ['Adventure', 'Culture', 'Wellness', 'Food', 'Nature', 'Transport']

export type Difficulty = 'Easy' | 'Moderate' | 'Challenging' | 'Expert'

export type Experience = {
  slug: string
  title: string
  destination: string
  category: ExperienceCategory
  activity: string
  verification: ListingStatus
  /**
   * Absent on a live listing.
   *
   * ADR-025 scoped destination imagery to this *content* set. A real
   * supplier's experience has no licensed photograph, and giving it a stock
   * one would be the exact thing that decision scoped away, so a live card
   * renders on its tinted plate instead.
   */
  image?: string
  priceMinor: number
  /** Defaults to `CONTENT_CURRENCY`. A live listing is in the property's currency. */
  currency?: string
  durationHours: number
  duration: string
  difficulty: Difficulty
  groupSize: string
  summary: string
  description: string[]
  /**
   * `role`, `years` and `bio` are optional because the database does not hold
   * them. Filling them in for a live listing would be inventing a biography
   * for a real person.
   */
  host: { name: string; role?: string; years?: number; bio?: string }
  itinerary: { time: string; step: string }[]
  meetingPoint: string
  hostClaims: string[]
  included: string[]
  provenance?: ListingProvenance
}

export type ArticleCategory = 'Destination Stories' | 'Adventure' | 'Cultural Guides' | 'Travel Technology'

export type Article = {
  slug: string
  title: string
  dek: string
  category: ArticleCategory
  author: string
  date: string
  readMinutes: number
  image: string
  featured: boolean
  destination?: string
  body: { heading?: string; text: string }[]
  pullQuote?: string
}

export type Pace = 'Slow' | 'Balanced' | 'Full'
export type Budget = 'Considered' | 'Comfort' | 'Luxury'

export type PlannerPreferences = {
  destination: string
  startDate: string
  endDate: string
  travelers: number
  budget: Budget
  style: TravelStyle
  accommodation: PropertyType | 'Any'
  activities: ExperienceCategory[]
  pace: Pace
}

export type ItineraryActivity = {
  id: string
  time: 'Morning' | 'Afternoon' | 'Evening'
  title: string
  detail: string
  costMinor: number
  category: ExperienceCategory | 'Logistics' | 'Dining' | 'Free'
  experienceSlug?: string
}

export type ItineraryDayPlan = {
  day: number
  date: string
  theme: string
  activities: ItineraryActivity[]
  lodgingMinor: number
}

export type Itinerary = {
  id: string
  title: string
  createdAt: string
  /** No `'ai'` member: a deterministic planner may not label itself a model. */
  source: 'sample' | 'rules-engine'
  preferences: PlannerPreferences
  stay?: string
  days: ItineraryDayPlan[]
  logistics: string[]
  recommendations: string[]
}
