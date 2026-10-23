import { buildItinerary } from '../planner'
import type { Itinerary } from './types'

/**
 * Three worked itineraries, used on the home page and as the "open a sample"
 * entry point on the planner.
 *
 * Built at module load from a fixed instant rather than `new Date()`, so the
 * fixtures are byte-identical on every render, in every test and in both the
 * server and the client bundle. A sample built from the current clock would
 * change its own `createdAt` and dates between a server render and a hydration
 * and produce a mismatch.
 */
const SAMPLE_INSTANT = new Date('2026-10-22T12:00:00.000Z')

const SAMPLE_TITLES = [
  'Surf and supper on the Oaxaca coast',
  'A slow week of Lisbon light',
  'High summer under Mont Blanc',
] as const

export const sampleItineraries: Itinerary[] = [
  buildItinerary(
    {
      destination: 'puerto-escondido',
      startDate: '2026-11-14',
      endDate: '2026-11-19',
      travelers: 2,
      budget: 'Comfort',
      style: 'Surf & Ocean',
      accommodation: 'Surf Lodge',
      activities: ['Adventure', 'Food', 'Nature'],
      pace: 'Balanced',
    },
    SAMPLE_INSTANT,
    'sample',
    'sample-puerto-escondido',
  ),
  buildItinerary(
    {
      destination: 'lisbon',
      startDate: '2027-04-20',
      endDate: '2027-04-24',
      travelers: 2,
      budget: 'Luxury',
      style: 'Culture & City',
      accommodation: 'Design Hotel',
      activities: ['Food', 'Culture'],
      pace: 'Slow',
    },
    SAMPLE_INSTANT,
    'sample',
    'sample-lisbon',
  ),
  buildItinerary(
    {
      destination: 'chamonix',
      startDate: '2027-07-06',
      endDate: '2027-07-12',
      travelers: 3,
      budget: 'Comfort',
      style: 'Mountain & Alpine',
      accommodation: 'Mountain Lodge',
      activities: ['Adventure', 'Nature'],
      pace: 'Full',
    },
    SAMPLE_INSTANT,
    'sample',
    'sample-chamonix',
  ),
].map((itinerary, i) => ({ ...itinerary, title: SAMPLE_TITLES[i]! }))

export const getSampleItinerary = (id?: string): Itinerary | undefined =>
  sampleItineraries.find((i) => i.id === id)
