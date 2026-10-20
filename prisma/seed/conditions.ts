import type { Rng } from './rng'

/**
 * Seven days of synthetic ocean conditions per coastal place.
 *
 * The bands below reflect each beach's real character — Zicatela is genuinely a
 * heavy, advanced-only wave and Carrizalillo is genuinely the sheltered option —
 * but the numbers themselves are invented. Every generated row carries
 * `provenance: SEED_FIXTURE`, a `source` of "ARC demo fixture" and an
 * `observedAt` timestamp, because the product's rule is that a reading is
 * always shown with its age and never as a safety guarantee.
 */
interface Band {
  waveMin: number
  waveMax: number
  /** Risk bands this place can produce, weighted by order (first is commonest). */
  risks: Array<'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME'>
  currentEn: string
  currentEs: string
}

const BANDS: Record<string, Band> = {
  'playa-zicatela': {
    waveMin: 1.8,
    waveMax: 4.6,
    risks: ['EXTREME', 'HIGH', 'EXTREME', 'HIGH'],
    currentEn: 'Strong rip running north along the beach; shore break dumping on the sand.',
    currentEs: 'Corriente de retorno fuerte hacia el norte; la rompiente descarga en la arena.',
  },
  'la-punta-zicatela': {
    waveMin: 0.9,
    waveMax: 2.6,
    risks: ['HIGH', 'MODERATE', 'HIGH', 'MODERATE'],
    currentEn: 'Current pulls down the point towards the river mouth; rocky entry at low tide.',
    currentEs: 'La corriente jala a lo largo de la punta hacia la boca del río; entrada rocosa con marea baja.',
  },
  'playa-carrizalillo': {
    waveMin: 0.3,
    waveMax: 1.3,
    risks: ['LOW', 'LOW', 'MODERATE', 'LOW'],
    currentEn: 'Light circulation inside the cove; mild pull past the northern rocks.',
    currentEs: 'Circulación ligera dentro de la cala; jalón suave al pasar las rocas del norte.',
  },
  'playa-principal': {
    waveMin: 0.4,
    waveMax: 1.5,
    risks: ['LOW', 'MODERATE', 'LOW', 'LOW'],
    currentEn: 'Calm in the harbour; panga traffic in the channel at the eastern end.',
    currentEs: 'Calma en el puerto; tráfico de pangas en el canal del extremo este.',
  },
  'puerto-angelito': {
    waveMin: 0.2,
    waveMax: 0.9,
    risks: ['LOW', 'LOW', 'LOW', 'MODERATE'],
    currentEn: 'Shallow and sheltered; boat traffic close to shore.',
    currentEs: 'Poco profundo y protegido; lanchas cerca de la orilla.',
  },
  'playa-bacocho': {
    waveMin: 1.2,
    waveMax: 2.9,
    risks: ['HIGH', 'HIGH', 'MODERATE', 'EXTREME'],
    currentEn: 'Heavy shore dump with rips along the length of the beach.',
    currentEs: 'Rompiente pesada en la orilla con corrientes de retorno a lo largo de la playa.',
  },
}

const SUITABLE_UP_TO = {
  LOW: 'BEGINNER',
  MODERATE: 'IMPROVER',
  HIGH: 'ADVANCED',
  EXTREME: 'EXPERT',
} as const

export interface GeneratedCondition {
  placeSlug: string
  forDate: string
  waveHeightMinM: number
  waveHeightMaxM: number
  swellPeriodS: number
  windKph: number
  windDirection: string
  waterTempC: number
  airTempC: number
  currentNotesEn: string
  currentNotesEs: string
  highTideLocal: string
  lowTideLocal: string
  risk: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME'
  suitableUpTo: 'BEGINNER' | 'IMPROVER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT'
  guideRecommended: boolean
}

const WIND_DIRECTIONS = ['NNW', 'NW', 'W', 'SW', 'SSW', 'S', 'SSE'] as const
const round1 = (n: number): number => Math.round(n * 10) / 10

export function generateConditions(
  rng: Rng,
  placeSlugs: string[],
  dateKeys: string[],
): GeneratedCondition[] {
  const out: GeneratedCondition[] = []

  for (const placeSlug of placeSlugs) {
    const band = BANDS[placeSlug]
    if (!band) continue

    for (const [dayIndex, forDate] of dateKeys.entries()) {
      // One swell event walks through the week so consecutive days correlate,
      // the way a real forecast would, instead of jittering independently.
      const swellPhase = Math.sin((dayIndex / dateKeys.length) * Math.PI * 1.4)
      const span = band.waveMax - band.waveMin
      const waveMin = band.waveMin + span * 0.25 * Math.max(0, swellPhase)
      const waveMax = waveMin + span * (0.35 + 0.4 * Math.max(0, swellPhase))

      const riskIndex = swellPhase > 0.6 ? 0 : rng.int(0, band.risks.length - 1)
      const risk = band.risks[riskIndex] ?? band.risks[0] ?? 'MODERATE'

      const highTideMinutes = 6 * 60 + dayIndex * 50 + rng.int(0, 25)
      const lowTideMinutes = highTideMinutes + 6 * 60 + 12

      out.push({
        placeSlug,
        forDate,
        waveHeightMinM: round1(waveMin),
        waveHeightMaxM: round1(waveMax),
        swellPeriodS: round1(11 + swellPhase * 5 + rng.next() * 2),
        windKph: round1(6 + rng.next() * 18),
        windDirection: rng.pick(WIND_DIRECTIONS),
        waterTempC: round1(27 + rng.next() * 2),
        airTempC: round1(29 + rng.next() * 3),
        currentNotesEn: band.currentEn,
        currentNotesEs: band.currentEs,
        highTideLocal: formatMinutes(highTideMinutes),
        lowTideLocal: formatMinutes(lowTideMinutes),
        risk,
        suitableUpTo: SUITABLE_UP_TO[risk],
        // A guide is recommended for anything above a calm day, and always for
        // the two breaks that can hurt people.
        guideRecommended: risk !== 'LOW' || placeSlug.includes('zicatela'),
      })
    }
  }

  return out
}

function formatMinutes(total: number): string {
  const wrapped = ((total % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = wrapped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
