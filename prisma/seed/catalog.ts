/**
 * Activity and supplier fixtures.
 *
 * Suppliers here are entirely fictional. Their names, contacts and
 * certifications are invented, every one is seeded `verification: UNVERIFIED`,
 * and `requiresManualConfirmation` is true on every agreement — the POC never
 * implies a real commercial relationship or an automated payout.
 *
 * Activity suitability (`minAbility`, `maxSafeRisk`, `guideRequired`) is the
 * safety contract. The itinerary generator treats these as hard gates.
 */
export interface ActivityFixture {
  slug: string
  name: string
  category: 'SURF' | 'WELLNESS' | 'ADVENTURE' | 'DINING' | 'TRANSPORT' | 'CULTURE'
  placeSlug: string
  descriptionEn: string
  descriptionEs: string
  minAbility: 'BEGINNER' | 'IMPROVER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT'
  maxAbility: 'BEGINNER' | 'IMPROVER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT'
  guideRequired: boolean
  /** Whether ocean or weather conditions govern it. Omit to default to true. */
  conditionsSensitive?: boolean
  maxSafeRisk: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME'
  minAgeYears?: number
  durationMinutes: number
  seasonMonths?: number[]
  earliestStart: string
  latestStart: string
  physicalIntensity: number
  safetyNotesEn?: string
  safetyNotesEs?: string
}

export const ACTIVITIES: ActivityFixture[] = [
  {
    slug: 'beginner-surf-lesson',
    name: 'Beginner surf lesson',
    category: 'SURF',
    placeSlug: 'playa-carrizalillo',
    descriptionEn:
      'First time on a board, in the most sheltered water in town. Soft-top boards, one instructor per two or three people.',
    descriptionEs:
      'Primera vez sobre una tabla, en el agua más protegida del pueblo. Tablas blandas, un instructor por cada dos o tres personas.',
    minAbility: 'BEGINNER',
    maxAbility: 'IMPROVER',
    guideRequired: true,
    maxSafeRisk: 'MODERATE',
    minAgeYears: 8,
    durationMinutes: 120,
    earliestStart: '07:00',
    latestStart: '16:00',
    physicalIntensity: 3,
    safetyNotesEn:
      'Cancelled outright when the cove is rated high risk. A certified instructor is mandatory, not optional.',
    safetyNotesEs:
      'Se cancela por completo cuando la cala se clasifica como de riesgo alto. Un instructor certificado es obligatorio, no opcional.',
  },
  {
    slug: 'surf-progression-coaching',
    name: 'Surf progression coaching',
    category: 'SURF',
    placeSlug: 'la-punta-zicatela',
    descriptionEn:
      'Video-reviewed coaching on the point for surfers who can already paddle out and catch unbroken waves.',
    descriptionEs:
      'Coaching con revisión de video en la punta, para surfistas que ya pueden remar afuera y tomar olas sin romper.',
    minAbility: 'IMPROVER',
    maxAbility: 'ADVANCED',
    guideRequired: true,
    maxSafeRisk: 'HIGH',
    minAgeYears: 14,
    durationMinutes: 150,
    earliestStart: '06:30',
    latestStart: '15:30',
    physicalIntensity: 4,
    safetyNotesEn:
      'Rocky entry and a strong down-the-point current. The coach decides on the day whether the session runs.',
    safetyNotesEs:
      'Entrada rocosa y corriente fuerte a lo largo de la punta. El coach decide el mismo día si la sesión se realiza.',
  },
  {
    slug: 'zicatela-guided-session',
    name: 'Zicatela guided session',
    category: 'SURF',
    placeSlug: 'playa-zicatela',
    descriptionEn:
      'A guided session on the beach break for experienced surfers: entry timing, line-up positioning and a water safety plan.',
    descriptionEs:
      'Una sesión guiada en el beach break para surfistas con experiencia: tiempos de entrada, posicionamiento en el line-up y un plan de seguridad en el agua.',
    minAbility: 'ADVANCED',
    maxAbility: 'EXPERT',
    guideRequired: true,
    maxSafeRisk: 'EXTREME',
    minAgeYears: 18,
    durationMinutes: 120,
    earliestStart: '06:00',
    latestStart: '16:00',
    physicalIntensity: 5,
    safetyNotesEn:
      'Zicatela is an advanced-only wave with a punishing shore break. ARC will not match this to any guest below ADVANCED under any conditions.',
    safetyNotesEs:
      'Zicatela es una ola solo para avanzados, con una rompiente de orilla castigadora. ARC no la asignará a ningún huésped por debajo de ADVANCED bajo ninguna condición.',
  },
  {
    slug: 'sunrise-beach-yoga',
    conditionsSensitive: false,
    name: 'Sunrise yoga',
    category: 'WELLNESS',
    placeSlug: 'la-rinconada',
    descriptionEn: 'Slow hatha on the rooftop as the light comes up, mats provided.',
    descriptionEs: 'Hatha pausado en la azotea mientras sale la luz, con tapetes incluidos.',
    minAbility: 'BEGINNER',
    maxAbility: 'EXPERT',
    guideRequired: false,
    maxSafeRisk: 'EXTREME',
    durationMinutes: 75,
    earliestStart: '06:00',
    latestStart: '08:30',
    physicalIntensity: 2,
  },
  {
    slug: 'temazcal-ritual',
    conditionsSensitive: false,
    name: 'Temazcal and massage ritual',
    category: 'WELLNESS',
    placeSlug: 'la-rinconada',
    descriptionEn:
      'A traditional steam ceremony with herbs, followed by a deep-tissue massage. Two and a half hours, late afternoon.',
    descriptionEs:
      'Una ceremonia tradicional de vapor con hierbas, seguida de un masaje profundo. Dos horas y media, por la tarde.',
    minAbility: 'BEGINNER',
    maxAbility: 'EXPERT',
    guideRequired: true,
    maxSafeRisk: 'EXTREME',
    minAgeYears: 16,
    durationMinutes: 150,
    earliestStart: '15:00',
    latestStart: '18:00',
    physicalIntensity: 1,
    safetyNotesEn:
      'Extended heat exposure. Not advisable if you are pregnant or have a cardiovascular condition — tell the practitioner first.',
    safetyNotesEs:
      'Exposición prolongada al calor. No se aconseja en embarazo ni con condiciones cardiovasculares: avisa primero a quien dirige la ceremonia.',
  },
  {
    slug: 'bioluminescence-night-paddle',
    name: 'Bioluminescence night paddle',
    category: 'ADVENTURE',
    placeSlug: 'laguna-manialtepec',
    descriptionEn:
      'Paddle into the mangrove channels after dark to look for bioluminescent plankton. Visibility depends on the moon and recent rain.',
    descriptionEs:
      'Remar hacia los canales de manglar después del anochecer para buscar plancton bioluminiscente. La visibilidad depende de la luna y de las lluvias recientes.',
    minAbility: 'BEGINNER',
    maxAbility: 'EXPERT',
    guideRequired: true,
    maxSafeRisk: 'MODERATE',
    minAgeYears: 10,
    durationMinutes: 210,
    seasonMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    earliestStart: '19:00',
    latestStart: '21:00',
    physicalIntensity: 2,
    safetyNotesEn:
      'Night paddle on open water with life vests mandatory. Plankton glow cannot be promised for a specific date.',
    safetyNotesEs:
      'Remada nocturna en agua abierta con chaleco obligatorio. El brillo del plancton no puede prometerse para una fecha concreta.',
  },
  {
    slug: 'dawn-boat-wildlife-tour',
    name: 'Dawn dolphin and turtle boat tour',
    category: 'ADVENTURE',
    placeSlug: 'playa-principal',
    descriptionEn:
      'Out past the point at first light in a panga, looking for dolphins and sea turtles. Sightings are never guaranteed.',
    descriptionEs:
      'Salir más allá de la punta con la primera luz en una panga, buscando delfines y tortugas marinas. Los avistamientos nunca están garantizados.',
    minAbility: 'BEGINNER',
    maxAbility: 'EXPERT',
    guideRequired: true,
    maxSafeRisk: 'MODERATE',
    minAgeYears: 6,
    durationMinutes: 150,
    earliestStart: '06:00',
    latestStart: '08:00',
    physicalIntensity: 1,
    safetyNotesEn:
      'Small open boat in ocean swell. Cancelled when the harbour is rated high risk; motion sickness is common.',
    safetyNotesEs:
      'Lancha pequeña y abierta en marejada oceánica. Se cancela cuando el puerto se clasifica de riesgo alto; el mareo es común.',
  },
  {
    slug: 'cove-snorkel',
    name: 'Cove snorkel and swim',
    category: 'ADVENTURE',
    placeSlug: 'playa-carrizalillo',
    descriptionEn:
      'Guided snorkel along the rocks at the edge of the cove. Masks, fins and a surface float included.',
    descriptionEs:
      'Esnórquel guiado a lo largo de las rocas al borde de la cala. Visor, aletas y boya de superficie incluidos.',
    minAbility: 'BEGINNER',
    maxAbility: 'INTERMEDIATE',
    guideRequired: true,
    maxSafeRisk: 'LOW',
    minAgeYears: 8,
    durationMinutes: 105,
    earliestStart: '08:00',
    latestStart: '15:00',
    physicalIntensity: 3,
    safetyNotesEn:
      'Runs only when the cove is rated low risk. Comfortable swimming in open water is required.',
    safetyNotesEs:
      'Solo se realiza cuando la cala se clasifica de riesgo bajo. Se requiere nadar con soltura en agua abierta.',
  },
  {
    slug: 'coastal-cooking-class',
    conditionsSensitive: false,
    name: 'Oaxacan coastal cooking class',
    category: 'DINING',
    placeSlug: 'mercado-benito-juarez',
    descriptionEn:
      'Shop the market, then cook three coastal Oaxacan dishes over a wood comal and eat what you made.',
    descriptionEs:
      'Recorrer el mercado y luego cocinar tres platillos de la costa oaxaqueña en un comal de leña y comer lo que preparaste.',
    minAbility: 'BEGINNER',
    maxAbility: 'EXPERT',
    guideRequired: false,
    maxSafeRisk: 'EXTREME',
    durationMinutes: 240,
    earliestStart: '09:00',
    latestStart: '12:00',
    physicalIntensity: 1,
  },
  {
    slug: 'mezcal-adoquin-walk',
    conditionsSensitive: false,
    name: 'Mezcal and Adoquín walk',
    category: 'CULTURE',
    placeSlug: 'centro-adoquin',
    descriptionEn:
      'An evening walk through the old strip with three tasting stops and the back story of each distillate.',
    descriptionEs:
      'Una caminata nocturna por el andador con tres paradas de cata y la historia detrás de cada destilado.',
    minAbility: 'BEGINNER',
    maxAbility: 'EXPERT',
    guideRequired: false,
    maxSafeRisk: 'EXTREME',
    minAgeYears: 18,
    durationMinutes: 150,
    earliestStart: '18:00',
    latestStart: '20:00',
    physicalIntensity: 2,
  },
  {
    slug: 'airport-transfer',
    conditionsSensitive: false,
    name: 'Airport transfer',
    category: 'TRANSPORT',
    placeSlug: 'aeropuerto-pxm',
    descriptionEn: 'Private air-conditioned transfer between PXM and the property.',
    descriptionEs: 'Traslado privado con aire acondicionado entre PXM y la propiedad.',
    minAbility: 'BEGINNER',
    maxAbility: 'EXPERT',
    guideRequired: false,
    maxSafeRisk: 'EXTREME',
    durationMinutes: 30,
    earliestStart: '05:00',
    latestStart: '22:00',
    physicalIntensity: 1,
  },
  {
    slug: 'sunset-viewpoint-walk',
    conditionsSensitive: false,
    name: 'Sunset viewpoint walk',
    category: 'CULTURE',
    placeSlug: 'mirador-cerro-del-tigre',
    descriptionEn: 'A short guided climb to the western viewpoint for the sunset line.',
    descriptionEs: 'Una subida guiada y corta al mirador del oeste para la línea del atardecer.',
    minAbility: 'BEGINNER',
    maxAbility: 'EXPERT',
    guideRequired: false,
    maxSafeRisk: 'EXTREME',
    durationMinutes: 90,
    earliestStart: '16:30',
    latestStart: '18:00',
    physicalIntensity: 2,
  },
]

export interface SupplierFixture {
  slug: string
  name: string
  legalName: string
  description: string
  categories: Array<'SURF' | 'WELLNESS' | 'ADVENTURE' | 'DINING' | 'TRANSPORT' | 'CULTURE'>
  placeSlug: string
  contactName: string
  contactEmail: string
  contactPhone: string
  /** Claimed only. Never rendered as confirmed until an admin records a check. */
  claimedCertifications: string[]
  /**
   * Whether the business *says* it carries liability cover.
   *
   * Not `insuranceOnFile`, which is ARC's own record of having seen a
   * certificate and is written only by the admin verification path. The seed
   * creates unverified partners, so the only honest thing it can express is the
   * claim — and a CHECK constraint now refuses the other reading (ADR-041).
   */
  claimsInsurance: boolean
  hotelCommissionBps: number
  platformCommissionBps: number
}

export const SUPPLIERS: SupplierFixture[] = [
  {
    slug: 'olas-verdes',
    name: 'Escuela Olas Verdes',
    legalName: 'Olas Verdes Escuela de Surf S. de R.L. (fictional)',
    description:
      'Fictional surf school working the sheltered western coves. Beginner lessons and guided snorkel.',
    categories: ['SURF', 'ADVENTURE'],
    placeSlug: 'playa-carrizalillo',
    contactName: 'Mariana Robles',
    contactEmail: 'mariana@olasverdes.demo',
    contactPhone: '+52 954 000 0101',
    claimedCertifications: ['ISA Level 1 instruction (claimed)', 'Open-water lifesaving (claimed)'],
    claimsInsurance: true,
    hotelCommissionBps: 1500,
    platformCommissionBps: 500,
  },
  {
    slug: 'punta-surf-collective',
    name: 'Punta Surf Collective',
    legalName: 'Colectivo Punta Surf (fictional)',
    description:
      'Fictional coaching collective on the La Punta point, plus guided sessions on the Zicatela beach break.',
    categories: ['SURF'],
    placeSlug: 'la-punta-zicatela',
    contactName: 'Diego Cárdenas',
    contactEmail: 'diego@puntasurf.demo',
    contactPhone: '+52 954 000 0102',
    claimedCertifications: ['ISA Level 2 coaching (claimed)', 'Wilderness first responder (claimed)'],
    claimsInsurance: true,
    hotelCommissionBps: 1200,
    platformCommissionBps: 500,
  },
  {
    slug: 'costa-serena',
    name: 'Costa Serena Wellness',
    legalName: 'Costa Serena Bienestar (fictional)',
    description:
      'Fictional wellness practice: rooftop yoga, temazcal ceremony and massage, working on-site at partner hotels.',
    categories: ['WELLNESS'],
    placeSlug: 'la-rinconada',
    contactName: 'Lucía Hernández',
    contactEmail: 'lucia@costaserena.demo',
    contactPhone: '+52 954 000 0103',
    claimedCertifications: ['Yoga Alliance RYT-500 (claimed)'],
    claimsInsurance: false,
    hotelCommissionBps: 2000,
    platformCommissionBps: 500,
  },
  {
    slug: 'manialtepec-expediciones',
    name: 'Manialtepec Expediciones',
    legalName: 'Expediciones Manialtepec (fictional)',
    description:
      'Fictional lagoon and boat operator: dawn wildlife pangas from Playa Principal and night paddles on the lagoon.',
    categories: ['ADVENTURE'],
    placeSlug: 'laguna-manialtepec',
    contactName: 'Rafael Cruz',
    contactEmail: 'rafael@manialtepec.demo',
    contactPhone: '+52 954 000 0104',
    claimedCertifications: ['SEMARNAT wildlife-viewing permit (claimed)', 'Boat master licence (claimed)'],
    claimsInsurance: true,
    hotelCommissionBps: 1500,
    platformCommissionBps: 500,
  },
  {
    slug: 'cocina-tia-mina',
    name: 'Cocina Tía Mina',
    legalName: 'Cocina de Tía Mina (fictional)',
    description:
      'Fictional home kitchen running market-to-table cooking classes and an evening mezcal walk.',
    categories: ['DINING', 'CULTURE'],
    placeSlug: 'mercado-benito-juarez',
    contactName: 'Guillermina Santiago',
    contactEmail: 'mina@cocinatiamina.demo',
    contactPhone: '+52 954 000 0105',
    claimedCertifications: ['Municipal food-handling certificate (claimed)'],
    claimsInsurance: false,
    hotelCommissionBps: 1800,
    platformCommissionBps: 500,
  },
  {
    slug: 'traslados-costa-chica',
    name: 'Traslados Costa Chica',
    legalName: 'Traslados Costa Chica (fictional)',
    description: 'Fictional private transfer operator covering PXM, the coves and the Zicatela strip.',
    categories: ['TRANSPORT'],
    placeSlug: 'aeropuerto-pxm',
    contactName: 'Óscar Jiménez',
    contactEmail: 'oscar@costachica.demo',
    contactPhone: '+52 954 000 0106',
    claimedCertifications: ['Federal passenger-transport permit (claimed)'],
    claimsInsurance: true,
    hotelCommissionBps: 1000,
    platformCommissionBps: 500,
  },
]

export interface ExperienceFixture {
  slug: string
  supplierSlug: string
  activitySlug: string
  placeSlug: string
  titleEn: string
  titleEs: string
  summaryEn: string
  summaryEs: string
  descriptionEn: string
  descriptionEs: string
  /** Per-person price in centavos. Demo data. */
  priceMinor: number
  bookingFeeMinor: number
  durationMinutes: number
  defaultCapacity: number
  minParty: number
  maxParty: number
  includesTransfer: boolean
  meetingPoint: string
  whatToBringEn: string
  whatToBringEs: string
  /** Local start times offered on a normal day. */
  startTimes: string[]
  status: 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'PAUSED' | 'ARCHIVED'
  /** Links the experience back to a hotel amenity it was productised from. */
  fromAmenity?: string
}

export const EXPERIENCES: ExperienceFixture[] = [
  {
    slug: 'carrizalillo-beginner-surf-lesson',
    supplierSlug: 'olas-verdes',
    activitySlug: 'beginner-surf-lesson',
    placeSlug: 'playa-carrizalillo',
    titleEn: 'First waves at Carrizalillo',
    titleEs: 'Primeras olas en Carrizalillo',
    summaryEn: 'Two hours on a soft-top in the calmest cove in Puerto Escondido.',
    summaryEs: 'Dos horas sobre una tabla blanda en la cala más tranquila de Puerto Escondido.',
    descriptionEn:
      'Mariana’s team meets you at the top of the Carrizalillo stairway, carries the boards down, and spends the first twenty minutes on the sand on positioning and the pop-up. Then two hours in the water, two or three people per instructor. Expect to stand up; expect to fall off a lot first.',
    descriptionEs:
      'El equipo de Mariana te recibe arriba de la escalera de Carrizalillo, baja las tablas y dedica los primeros veinte minutos en la arena a la posición y al pop-up. Después, dos horas en el agua, dos o tres personas por instructor. Espera ponerte de pie; espera caerte muchas veces antes.',
    priceMinor: 95000,
    bookingFeeMinor: 0,
    durationMinutes: 120,
    defaultCapacity: 6,
    minParty: 1,
    maxParty: 6,
    includesTransfer: false,
    meetingPoint: 'Top of the Carrizalillo stairway, by the taxi turnaround',
    whatToBringEn: 'Swimwear, reef-safe sunscreen, a towel, water. Rash vest provided.',
    whatToBringEs: 'Traje de baño, bloqueador amigable con el arrecife, toalla, agua. Licra incluida.',
    startTimes: ['07:30', '10:00', '15:30'],
    status: 'PUBLISHED',
  },
  {
    slug: 'la-punta-progression-coaching',
    supplierSlug: 'punta-surf-collective',
    activitySlug: 'surf-progression-coaching',
    placeSlug: 'la-punta-zicatela',
    titleEn: 'La Punta progression coaching',
    titleEs: 'Coaching de progresión en La Punta',
    summaryEn: 'Video-reviewed coaching on the point. You should already be catching unbroken waves.',
    summaryEs: 'Coaching con revisión de video en la punta. Ya deberías estar tomando olas sin romper.',
    descriptionEn:
      'Diego films the session from the sand, then sits down with you over a coffee and goes through it frame by frame. The focus is the paddle-out, wave selection and getting off the bottom turn. Not a first lesson.',
    descriptionEs:
      'Diego graba la sesión desde la arena y luego se sienta contigo con un café para revisarla cuadro por cuadro. El enfoque está en la remada de salida, la selección de olas y salir del bottom turn. No es una primera clase.',
    priceMinor: 160000,
    bookingFeeMinor: 0,
    durationMinutes: 150,
    defaultCapacity: 4,
    minParty: 1,
    maxParty: 4,
    includesTransfer: true,
    meetingPoint: 'La Punta, beach access at the end of Calle Las Brisas',
    whatToBringEn: 'Your own board if you have one, swimwear, sunscreen, water.',
    whatToBringEs: 'Tu propia tabla si tienes, traje de baño, bloqueador, agua.',
    startTimes: ['06:45', '15:00'],
    status: 'PUBLISHED',
  },
  {
    slug: 'zicatela-guided-advanced-session',
    supplierSlug: 'punta-surf-collective',
    activitySlug: 'zicatela-guided-session',
    placeSlug: 'playa-zicatela',
    titleEn: 'Zicatela guided session — advanced only',
    titleEs: 'Sesión guiada en Zicatela — solo avanzados',
    summaryEn: 'A water-safety-led session on the beach break. Advanced and expert surfers only.',
    summaryEs: 'Una sesión en el beach break centrada en seguridad en el agua. Solo surfistas avanzados y expertos.',
    descriptionEn:
      'This is not a lesson. A guide reads the sets with you from the sand, times your entry, and watches the water for the whole session with a plan for getting you out if it goes wrong. Zicatela is a serious wave and the guide will call the session off without discussion.',
    descriptionEs:
      'Esto no es una clase. Un guía lee las series contigo desde la arena, cronometra tu entrada y vigila el agua toda la sesión con un plan para sacarte si algo sale mal. Zicatela es una ola seria y el guía cancelará la sesión sin discusión.',
    priceMinor: 210000,
    bookingFeeMinor: 0,
    durationMinutes: 120,
    defaultCapacity: 3,
    minParty: 1,
    maxParty: 3,
    includesTransfer: true,
    meetingPoint: 'Zicatela, beach access opposite Calle del Morro 300',
    whatToBringEn: 'Your own performance board, leash, swimwear. Helmet optional, available on request.',
    whatToBringEs: 'Tu tabla de performance, invento, traje de baño. Casco opcional, disponible a pedido.',
    startTimes: ['06:15'],
    status: 'PUBLISHED',
  },
  {
    slug: 'casa-olas-sunrise-yoga',
    supplierSlug: 'costa-serena',
    activitySlug: 'sunrise-beach-yoga',
    placeSlug: 'la-rinconada',
    titleEn: 'Sunrise yoga on the Casa Olas roof',
    titleEs: 'Yoga al amanecer en la azotea de Casa Olas',
    summaryEn: 'Seventy-five minutes of slow hatha as the light comes up over the coves.',
    summaryEs: 'Setenta y cinco minutos de hatha pausado mientras sale la luz sobre las calas.',
    descriptionEn:
      'Lucía teaches on the Casa Olas roof terrace four mornings a week. Slow, breath-led, suitable if you have never practised. Mats, blocks and tea are there when you arrive.',
    descriptionEs:
      'Lucía da clase en la azotea de Casa Olas cuatro mañanas por semana. Pausada, guiada por la respiración, apta si nunca has practicado. Tapetes, bloques y té están listos cuando llegas.',
    priceMinor: 35000,
    bookingFeeMinor: 0,
    durationMinutes: 75,
    defaultCapacity: 10,
    minParty: 1,
    maxParty: 10,
    includesTransfer: false,
    meetingPoint: 'Casa Olas roof terrace, third floor',
    whatToBringEn: 'Comfortable clothes. Everything else is provided.',
    whatToBringEs: 'Ropa cómoda. Todo lo demás está incluido.',
    startTimes: ['06:30'],
    status: 'PUBLISHED',
    fromAmenity: 'Rooftop terrace',
  },
  {
    slug: 'temazcal-and-massage-ritual',
    supplierSlug: 'costa-serena',
    activitySlug: 'temazcal-ritual',
    placeSlug: 'la-rinconada',
    titleEn: 'Temazcal and massage ritual',
    titleEs: 'Ritual de temazcal y masaje',
    summaryEn: 'A traditional herb steam ceremony followed by an hour of deep-tissue work.',
    summaryEs: 'Una ceremonia tradicional de vapor con hierbas seguida de una hora de masaje profundo.',
    descriptionEn:
      'Ninety minutes in the temazcal with copal, rosemary and eucalyptus, then an hour on the table. Go gently afterwards — most people sleep for ten hours. Tell Lucía about any heart condition or pregnancy when you book.',
    descriptionEs:
      'Noventa minutos en el temazcal con copal, romero y eucalipto, y luego una hora en la mesa. Ve con calma después: la mayoría duerme diez horas. Avísale a Lucía de cualquier condición cardiaca o embarazo al reservar.',
    priceMinor: 180000,
    bookingFeeMinor: 0,
    durationMinutes: 150,
    defaultCapacity: 4,
    minParty: 1,
    maxParty: 4,
    includesTransfer: true,
    meetingPoint: 'Casa Olas lobby — transfer to the Costa Serena temazcal',
    whatToBringEn: 'Swimwear, a change of clothes. Towels and robes provided.',
    whatToBringEs: 'Traje de baño, ropa de cambio. Toallas y batas incluidas.',
    startTimes: ['16:00'],
    status: 'PUBLISHED',
  },
  {
    slug: 'manialtepec-bioluminescence-paddle',
    supplierSlug: 'manialtepec-expediciones',
    activitySlug: 'bioluminescence-night-paddle',
    placeSlug: 'laguna-manialtepec',
    titleEn: 'Bioluminescence night paddle, Laguna de Manialtepec',
    titleEs: 'Remada nocturna de bioluminiscencia, Laguna de Manialtepec',
    summaryEn: 'Paddle the mangrove channels after dark. The glow depends on the moon — it is never promised.',
    summaryEs: 'Remar los canales de manglar después del anochecer. El brillo depende de la luna: nunca se promete.',
    descriptionEn:
      'Forty minutes out of town by shuttle, then onto the water. Rafael takes you into the mangrove channels where the plankton concentrate. On a dark, still night the water lights up around the paddle. On a bright or windy night it does not, and he will tell you so before you get in the boat.',
    descriptionEs:
      'Cuarenta minutos fuera del pueblo en transporte y luego al agua. Rafael te lleva a los canales de manglar donde se concentra el plancton. En una noche oscura y sin viento, el agua se ilumina alrededor del remo. En una noche clara o con viento, no, y él te lo dirá antes de subir a la lancha.',
    priceMinor: 125000,
    bookingFeeMinor: 15000,
    durationMinutes: 210,
    defaultCapacity: 8,
    minParty: 2,
    maxParty: 8,
    includesTransfer: true,
    meetingPoint: 'Casa Olas lobby — shuttle departs 40 minutes before launch',
    whatToBringEn: 'Long sleeves, insect repellent, a dry bag. No phone lights on the water.',
    whatToBringEs: 'Manga larga, repelente, bolsa seca. Sin luces de celular en el agua.',
    startTimes: ['19:30'],
    status: 'PUBLISHED',
  },
  {
    slug: 'dawn-dolphin-turtle-boat-tour',
    supplierSlug: 'manialtepec-expediciones',
    activitySlug: 'dawn-boat-wildlife-tour',
    placeSlug: 'playa-principal',
    titleEn: 'Dawn dolphin and turtle panga',
    titleEs: 'Panga al amanecer: delfines y tortugas',
    summaryEn: 'First light out past the point in an open boat. Sightings are likely, never guaranteed.',
    summaryEs: 'Primera luz más allá de la punta en lancha abierta. Los avistamientos son probables, nunca garantizados.',
    descriptionEn:
      'You push off the sand at Playa Principal before the sun is properly up. Spinner dolphins are common through the winter months, turtles year round, and in February and March there is a real chance of humpbacks. Two and a half hours, no shade, open swell.',
    descriptionEs:
      'Sales de la arena en Playa Principal antes de que el sol salga por completo. Los delfines tornillo son comunes en los meses de invierno, las tortugas todo el año, y en febrero y marzo hay posibilidad real de ballenas jorobadas. Dos horas y media, sin sombra, mar abierto.',
    priceMinor: 85000,
    bookingFeeMinor: 0,
    durationMinutes: 150,
    defaultCapacity: 8,
    minParty: 2,
    maxParty: 8,
    includesTransfer: true,
    meetingPoint: 'Playa Principal, east end by the panga launch',
    whatToBringEn: 'Hat, sunscreen, windbreaker, motion-sickness tablets if you are prone.',
    whatToBringEs: 'Gorra, bloqueador, rompevientos, pastillas para el mareo si eres propenso.',
    startTimes: ['06:30'],
    status: 'PUBLISHED',
  },
  {
    slug: 'carrizalillo-cove-snorkel',
    supplierSlug: 'olas-verdes',
    activitySlug: 'cove-snorkel',
    placeSlug: 'playa-carrizalillo',
    titleEn: 'Carrizalillo cove snorkel',
    titleEs: 'Esnórquel en la cala de Carrizalillo',
    summaryEn: 'Guided snorkel along the cove rocks. Runs only on low-risk days.',
    summaryEs: 'Esnórquel guiado por las rocas de la cala. Solo en días de riesgo bajo.',
    descriptionEn:
      'The rocks at the northern edge of Carrizalillo hold parrotfish, pufferfish and the occasional eagle ray. An hour and three quarters with a guide and a surface float. If the cove is anything other than calm, the session does not run.',
    descriptionEs:
      'Las rocas del borde norte de Carrizalillo guardan peces loro, botetes y de vez en cuando un águila marina. Una hora y tres cuartos con guía y boya de superficie. Si la cala no está en calma, la sesión no se realiza.',
    priceMinor: 70000,
    bookingFeeMinor: 0,
    durationMinutes: 105,
    defaultCapacity: 6,
    minParty: 1,
    maxParty: 6,
    includesTransfer: false,
    meetingPoint: 'Top of the Carrizalillo stairway, by the taxi turnaround',
    whatToBringEn: 'Swimwear, towel, reef-safe sunscreen. Mask, fins and float provided.',
    whatToBringEs: 'Traje de baño, toalla, bloqueador amigable con el arrecife. Visor, aletas y boya incluidos.',
    startTimes: ['09:00', '13:00'],
    status: 'PUBLISHED',
  },
  {
    slug: 'oaxacan-coastal-cooking-class',
    supplierSlug: 'cocina-tia-mina',
    activitySlug: 'coastal-cooking-class',
    placeSlug: 'mercado-benito-juarez',
    titleEn: 'Market to comal: coastal Oaxacan cooking',
    titleEs: 'Del mercado al comal: cocina costeña oaxaqueña',
    summaryEn: 'Shop the Benito Juárez market, then cook three coastal dishes over wood.',
    summaryEs: 'Comprar en el mercado Benito Juárez y cocinar tres platillos costeños a la leña.',
    descriptionEn:
      'Four hours with Guillermina. You start in the market picking chiles, quesillo and whatever came in from the boats, then cook in her courtyard: a tlayuda, pescado a la talla, and an agua fresca. You eat sitting down, with her family, at the end.',
    descriptionEs:
      'Cuatro horas con Guillermina. Empiezas en el mercado eligiendo chiles, quesillo y lo que haya llegado de las lanchas, y luego cocinas en su patio: una tlayuda, pescado a la talla y un agua fresca. Al final comes sentado, con su familia.',
    priceMinor: 145000,
    bookingFeeMinor: 0,
    durationMinutes: 240,
    defaultCapacity: 6,
    minParty: 2,
    maxParty: 6,
    includesTransfer: true,
    meetingPoint: 'Mercado Benito Juárez, main entrance on Avenida Oaxaca',
    whatToBringEn: 'An appetite. Vegetarian and gluten-free versions on request at booking.',
    whatToBringEs: 'Hambre. Versiones vegetariana y sin gluten a pedido al reservar.',
    startTimes: ['09:30'],
    status: 'PUBLISHED',
  },
  {
    slug: 'pxm-airport-private-transfer',
    supplierSlug: 'traslados-costa-chica',
    activitySlug: 'airport-transfer',
    placeSlug: 'aeropuerto-pxm',
    titleEn: 'PXM airport private transfer',
    titleEs: 'Traslado privado aeropuerto PXM',
    summaryEn: 'Private air-conditioned transfer between the airport and Casa Olas.',
    summaryEs: 'Traslado privado con aire acondicionado entre el aeropuerto y Casa Olas.',
    descriptionEn:
      'Óscar’s driver meets you inside the terminal with a name board. Ten minutes to the property, flat fare for up to four people and luggage. Flight delays are tracked and the pickup moves with them.',
    descriptionEs:
      'El chofer de Óscar te espera dentro de la terminal con un letrero. Diez minutos a la propiedad, tarifa fija hasta cuatro personas con equipaje. Se da seguimiento a los retrasos de vuelo y la recogida se ajusta.',
    priceMinor: 45000,
    bookingFeeMinor: 0,
    durationMinutes: 30,
    defaultCapacity: 4,
    minParty: 1,
    maxParty: 4,
    includesTransfer: false,
    meetingPoint: 'PXM arrivals hall, by the car-rental desks',
    whatToBringEn: 'Your flight number at booking.',
    whatToBringEs: 'Tu número de vuelo al reservar.',
    startTimes: ['08:00', '12:00', '16:00', '20:00'],
    status: 'PUBLISHED',
  },
]
