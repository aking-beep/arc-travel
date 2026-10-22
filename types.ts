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
  dailyFrom: number
  featured: boolean
  coords: { x: number; y: number }
  neighborhoods: Neighborhood[]
  itinerary: ItineraryPreviewDay[]
  travelInfo: { label: string; value: string }[]
}

export type PropertyType = 'Boutique Hotel' | 'Design Hotel' | 'Private Villa' | 'Eco Retreat' | 'Surf Lodge' | 'Mountain Lodge' | 'Wellness Retreat'

export const PROPERTY_TYPES: PropertyType[] = ['Boutique Hotel', 'Design Hotel', 'Private Villa', 'Eco Retreat', 'Surf Lodge', 'Mountain Lodge', 'Wellness Retreat']

export type Verification = 'verified' | 'illustrative'

export type Room = { name: string; sleeps: number; size: string; price: number; note: string }

export type Property = {
  slug: string
  name: string
  destination: string
  type: PropertyType
  verification: Verification
  images: string[]
  pricePerNight: number
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
  verification: Verification
  image: string
  price: number
  durationHours: number
  duration: string
  difficulty: Difficulty
  groupSize: string
  summary: string
  description: string[]
  host: { name: string; role: string; years: number; bio: string }
  itinerary: { time: string; step: string }[]
  meetingPoint: string
  safety: string[]
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
  cost: number
  category: ExperienceCategory | 'Logistics' | 'Dining' | 'Free'
  experienceSlug?: string
}

export type ItineraryDayPlan = {
  day: number
  date: string
  theme: string
  activities: ItineraryActivity[]
  lodging: number
}

export type Itinerary = {
  id: string
  title: string
  createdAt: string
  source: 'sample' | 'mock-generator' | 'ai'
  preferences: PlannerPreferences
  stay?: string
  days: ItineraryDayPlan[]
  logistics: string[]
  recommendations: string[]
}
