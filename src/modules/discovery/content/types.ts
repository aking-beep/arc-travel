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

export type Room = { name: string; sleeps: number; size: string; priceMinor: number; note: string }

export type Property = {
  slug: string
  name: string
  destination: string
  type: PropertyType
  verification: ListingStatus
  images: string[]
  pricePerNightMinor: number
  rating: number
  reviews: number
  summary: string
  description: string[]
  amenities: string[]
  rooms: Room[]
  location: string
  highlights: string[]
  checkIn: string
  checkOut: string
}

export type ExperienceCategory = 'Adventure' | 'Culture' | 'Wellness' | 'Food' | 'Nature'

export const EXPERIENCE_CATEGORIES: ExperienceCategory[] = ['Adventure', 'Culture', 'Wellness', 'Food', 'Nature']

export type Difficulty = 'Easy' | 'Moderate' | 'Challenging' | 'Expert'

export type Experience = {
  slug: string
  title: string
  destination: string
  category: ExperienceCategory
  activity: string
  verification: ListingStatus
  image: string
  priceMinor: number
  durationHours: number
  duration: string
  difficulty: Difficulty
  groupSize: string
  summary: string
  description: string[]
  host: { name: string; role: string; years: number; bio: string }
  itinerary: { time: string; step: string }[]
  meetingPoint: string
  hostClaims: string[]
  included: string[]
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
