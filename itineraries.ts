import { Itinerary } from './types'
import { buildItinerary } from '../lib/planner'

export const sampleItineraries: Itinerary[] = [
  buildItinerary(
    { destination: 'puerto-escondido', startDate: '2025-11-14', endDate: '2025-11-19', travelers: 2, budget: 'Comfort', style: 'Surf & Ocean', accommodation: 'Surf Lodge', activities: ['Adventure', 'Food', 'Nature'], pace: 'Balanced' },
    'sample',
    'sample-puerto-escondido',
  ),
  buildItinerary(
    { destination: 'lisbon', startDate: '2026-04-20', endDate: '2026-04-24', travelers: 2, budget: 'Luxury', style: 'Culture & City', accommodation: 'Design Hotel', activities: ['Food', 'Culture'], pace: 'Slow' },
    'sample',
    'sample-lisbon',
  ),
  buildItinerary(
    { destination: 'chamonix', startDate: '2026-07-06', endDate: '2026-07-12', travelers: 3, budget: 'Comfort', style: 'Mountain & Alpine', accommodation: 'Mountain Lodge', activities: ['Adventure', 'Nature'], pace: 'Full' },
    'sample',
    'sample-chamonix',
  ),
].map((it, i) => ({ ...it, title: ['Surf & supper on the Oaxaca coast', 'A slow week of Lisbon light', 'High summer under Mont Blanc'][i] }))
