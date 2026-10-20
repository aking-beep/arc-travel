/**
 * Synthetic people. Every name, email and phone number below is invented and
 * uses reserved `.demo` / `example.com` style addresses that cannot receive
 * mail. No real guest or staff data appears anywhere in this repository.
 */
export interface StaffFixture {
  email: string
  name: string
  role: 'OWNER' | 'STAFF' | 'ADMIN'
  locale: 'EN' | 'ES'
  phone?: string
}

export const STAFF: StaffFixture[] = [
  { email: 'elena@casaolas.demo', name: 'Elena Marín', role: 'OWNER', locale: 'ES', phone: '+52 954 000 0001' },
  { email: 'tomas@casaolas.demo', name: 'Tomás Beltrán', role: 'STAFF', locale: 'ES', phone: '+52 954 000 0002' },
  { email: 'frontdesk@casaolas.demo', name: 'Paola Ruiz', role: 'STAFF', locale: 'ES', phone: '+52 954 000 0003' },
  { email: 'admin@arctravel.demo', name: 'ARC Platform Admin', role: 'ADMIN', locale: 'EN' },
]

export interface RoomTypeFixture {
  code: string
  name: string
  description: string
  maxOccupancy: number
  roomCount: number
  /** Nightly rate in centavos. Demo data. */
  baseRateMinor: number
}

/** Five room types, twenty rooms. */
export const ROOM_TYPES: RoomTypeFixture[] = [
  {
    code: 'JARDIN',
    name: 'Casita Jardín',
    description: 'Ground-floor room opening onto the garden, outdoor shower, ceiling fan.',
    maxOccupancy: 2,
    roomCount: 6,
    baseRateMinor: 240000,
  },
  {
    code: 'ESTUDIO',
    name: 'Estudio Olas',
    description: 'First-floor studio with a kitchenette and a hammock on a private balcony.',
    maxOccupancy: 2,
    roomCount: 5,
    baseRateMinor: 320000,
  },
  {
    code: 'PALAPA',
    name: 'Palapa Suite',
    description: 'Palm-roofed suite with a separate sitting room and a partial cove view.',
    maxOccupancy: 3,
    roomCount: 4,
    baseRateMinor: 460000,
  },
  {
    code: 'FAMILIA',
    name: 'Casa Familia',
    description: 'Two bedrooms, one bathroom, shared terrace. Built for families and surf trips.',
    maxOccupancy: 5,
    roomCount: 3,
    baseRateMinor: 580000,
  },
  {
    code: 'MIRADOR',
    name: 'Mirador Penthouse',
    description: 'Top-floor room with a full ocean view, plunge pool and roof-terrace access.',
    maxOccupancy: 2,
    roomCount: 2,
    baseRateMinor: 780000,
  },
]

export interface AmenityFixture {
  name: string
  category: 'SURF' | 'WELLNESS' | 'ADVENTURE' | 'DINING' | 'TRANSPORT' | 'CULTURE'
  description: string
  isIncluded: boolean
  /** Experience slug this amenity was productised into, if any. */
  productisedAs?: string
}

export const AMENITIES: AmenityFixture[] = [
  {
    name: 'Rooftop terrace',
    category: 'WELLNESS',
    description: 'Third-floor terrace with ocean view, used for the morning yoga class.',
    isIncluded: true,
    productisedAs: 'casa-olas-sunrise-yoga',
  },
  {
    name: 'Board storage and rinse',
    category: 'SURF',
    description: 'Locked rack for twelve boards, freshwater rinse, wax and repair kit.',
    isIncluded: true,
  },
  {
    name: 'Loaner soft-top boards',
    category: 'SURF',
    description: 'Four 8ft soft-tops for guests. Not currently offered as a paid rental.',
    isIncluded: true,
  },
  {
    name: 'Breakfast on the patio',
    category: 'DINING',
    description: 'Included continental breakfast, 07:30 to 10:30.',
    isIncluded: true,
  },
  {
    name: 'Plunge pool',
    category: 'WELLNESS',
    description: 'Small cold plunge in the courtyard.',
    isIncluded: true,
  },
  {
    name: 'Airport pickup desk',
    category: 'TRANSPORT',
    description: 'Front desk arranges transfers with a local operator.',
    isIncluded: false,
    productisedAs: 'pxm-airport-private-transfer',
  },
  {
    name: 'Bicycles',
    category: 'ADVENTURE',
    description: 'Six town bikes. No helmets currently; not offered as a paid product.',
    isIncluded: true,
  },
]

export interface GuestFixture {
  firstName: string
  lastName: string
  email: string
  phone: string
  locale: 'EN' | 'ES'
  countryCode: string
  partySize: number
  surfAbility: 'BEGINNER' | 'IMPROVER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT' | null
  pace: 'RELAXED' | 'BALANCED' | 'PACKED' | null
  /** Daily per-person experience budget in centavos. */
  budgetPerDayMinor: number | null
  interests: Array<'SURF' | 'WELLNESS' | 'ADVENTURE' | 'DINING' | 'TRANSPORT' | 'CULTURE'>
  preferredTransport: Array<'WALK' | 'TAXI' | 'SHUTTLE' | 'MOTO' | 'BOAT'>
  dietaryNotes?: string
  mobilityNotes?: string
  /** False for guests who have not completed the portal intake yet. */
  intakeCompleted: boolean
}

/**
 * Twenty guest profiles spread deliberately across the matching space: every
 * ability level, every pace, budgets from tight to loose, two guests with
 * mobility constraints and four who have not completed intake (so the owner
 * briefing has real catalog gaps to report).
 */
export const GUESTS: GuestFixture[] = [
  {
    firstName: 'Harriet', lastName: 'Okonjo', email: 'harriet.okonjo@example.com', phone: '+44 7700 900001',
    locale: 'EN', countryCode: 'GB', partySize: 2, surfAbility: 'BEGINNER', pace: 'RELAXED',
    budgetPerDayMinor: 120000, interests: ['SURF', 'WELLNESS', 'DINING'], preferredTransport: ['WALK', 'TAXI'],
    dietaryNotes: 'Vegetarian', intakeCompleted: true,
  },
  {
    firstName: 'Mateo', lastName: 'Ferrer', email: 'mateo.ferrer@example.com', phone: '+34 600 000 002',
    locale: 'ES', countryCode: 'ES', partySize: 1, surfAbility: 'ADVANCED', pace: 'PACKED',
    budgetPerDayMinor: 300000, interests: ['SURF', 'ADVENTURE'], preferredTransport: ['MOTO', 'TAXI'],
    intakeCompleted: true,
  },
  {
    firstName: 'Nina', lastName: 'Brandt', email: 'nina.brandt@example.com', phone: '+49 151 0000003',
    locale: 'EN', countryCode: 'DE', partySize: 2, surfAbility: 'IMPROVER', pace: 'BALANCED',
    budgetPerDayMinor: 180000, interests: ['SURF', 'CULTURE', 'DINING'], preferredTransport: ['WALK', 'SHUTTLE'],
    intakeCompleted: true,
  },
  {
    firstName: 'Daniel', lastName: 'Whitlock', email: 'daniel.whitlock@example.com', phone: '+1 415 555 0004',
    locale: 'EN', countryCode: 'US', partySize: 4, surfAbility: 'BEGINNER', pace: 'RELAXED',
    budgetPerDayMinor: 220000, interests: ['ADVENTURE', 'DINING', 'WELLNESS'], preferredTransport: ['SHUTTLE'],
    dietaryNotes: 'One severe shellfish allergy in the party', intakeCompleted: true,
  },
  {
    firstName: 'Sofía', lastName: 'Lemus', email: 'sofia.lemus@example.com', phone: '+52 55 0000 0005',
    locale: 'ES', countryCode: 'MX', partySize: 2, surfAbility: 'INTERMEDIATE', pace: 'BALANCED',
    budgetPerDayMinor: 150000, interests: ['SURF', 'DINING'], preferredTransport: ['WALK', 'MOTO'],
    intakeCompleted: true,
  },
  {
    firstName: 'Jens', lastName: 'Lindqvist', email: 'jens.lindqvist@example.com', phone: '+46 70 000 0006',
    locale: 'EN', countryCode: 'SE', partySize: 2, surfAbility: 'EXPERT', pace: 'PACKED',
    budgetPerDayMinor: 400000, interests: ['SURF'], preferredTransport: ['TAXI'],
    intakeCompleted: true,
  },
  {
    firstName: 'Amara', lastName: 'Diallo', email: 'amara.diallo@example.com', phone: '+33 6 00 00 00 07',
    locale: 'EN', countryCode: 'FR', partySize: 1, surfAbility: null, pace: 'RELAXED',
    budgetPerDayMinor: 90000, interests: ['WELLNESS', 'CULTURE'], preferredTransport: ['WALK'],
    mobilityNotes: 'Recovering knee injury — no long stairways', intakeCompleted: true,
  },
  {
    firstName: 'Caleb', lastName: 'Stroud', email: 'caleb.stroud@example.com', phone: '+1 303 555 0008',
    locale: 'EN', countryCode: 'US', partySize: 3, surfAbility: 'IMPROVER', pace: 'PACKED',
    budgetPerDayMinor: 260000, interests: ['SURF', 'ADVENTURE', 'CULTURE'], preferredTransport: ['TAXI', 'BOAT'],
    intakeCompleted: true,
  },
  {
    firstName: 'Priya', lastName: 'Raman', email: 'priya.raman@example.com', phone: '+91 98000 00009',
    locale: 'EN', countryCode: 'IN', partySize: 2, surfAbility: 'BEGINNER', pace: 'BALANCED',
    budgetPerDayMinor: 140000, interests: ['WELLNESS', 'DINING', 'CULTURE'], preferredTransport: ['SHUTTLE', 'WALK'],
    dietaryNotes: 'Strict vegetarian, no eggs', intakeCompleted: true,
  },
  {
    firstName: 'Lucas', lastName: 'Moreau', email: 'lucas.moreau@example.com', phone: '+1 514 555 0010',
    locale: 'EN', countryCode: 'CA', partySize: 2, surfAbility: 'INTERMEDIATE', pace: 'BALANCED',
    budgetPerDayMinor: 200000, interests: ['SURF', 'ADVENTURE'], preferredTransport: ['TAXI', 'WALK'],
    intakeCompleted: true,
  },
  {
    firstName: 'Ingrid', lastName: 'Halvorsen', email: 'ingrid.halvorsen@example.com', phone: '+47 400 00011',
    locale: 'EN', countryCode: 'NO', partySize: 2, surfAbility: 'IMPROVER', pace: 'RELAXED',
    budgetPerDayMinor: 170000, interests: ['WELLNESS', 'SURF', 'DINING'], preferredTransport: ['WALK'],
    intakeCompleted: true,
  },
  {
    firstName: 'Rodrigo', lastName: 'Esquivel', email: 'rodrigo.esquivel@example.com', phone: '+52 998 000 0012',
    locale: 'ES', countryCode: 'MX', partySize: 5, surfAbility: 'BEGINNER', pace: 'RELAXED',
    budgetPerDayMinor: 110000, interests: ['DINING', 'ADVENTURE'], preferredTransport: ['SHUTTLE'],
    intakeCompleted: true,
  },
  {
    firstName: 'Yuki', lastName: 'Tanaka', email: 'yuki.tanaka@example.com', phone: '+81 90 0000 0013',
    locale: 'EN', countryCode: 'JP', partySize: 1, surfAbility: 'ADVANCED', pace: 'BALANCED',
    budgetPerDayMinor: 250000, interests: ['SURF', 'CULTURE'], preferredTransport: ['MOTO'],
    intakeCompleted: true,
  },
  {
    firstName: 'Fiona', lastName: 'Gallagher', email: 'fiona.gallagher@example.com', phone: '+353 86 000 0014',
    locale: 'EN', countryCode: 'IE', partySize: 2, surfAbility: null, pace: null,
    budgetPerDayMinor: null, interests: [], preferredTransport: [],
    intakeCompleted: false,
  },
  {
    firstName: 'Omar', lastName: 'Haddad', email: 'omar.haddad@example.com', phone: '+971 50 000 0015',
    locale: 'EN', countryCode: 'AE', partySize: 2, surfAbility: null, pace: null,
    budgetPerDayMinor: null, interests: [], preferredTransport: [],
    intakeCompleted: false,
  },
  {
    firstName: 'Camila', lastName: 'Ortega', email: 'camila.ortega@example.com', phone: '+54 9 11 0000 0016',
    locale: 'ES', countryCode: 'AR', partySize: 3, surfAbility: 'BEGINNER', pace: 'BALANCED',
    budgetPerDayMinor: 130000, interests: ['SURF', 'WELLNESS', 'ADVENTURE'], preferredTransport: ['WALK', 'TAXI'],
    intakeCompleted: true,
  },
  {
    firstName: 'Peter', lastName: 'Novák', email: 'peter.novak@example.com', phone: '+420 600 000 017',
    locale: 'EN', countryCode: 'CZ', partySize: 2, surfAbility: 'INTERMEDIATE', pace: 'PACKED',
    budgetPerDayMinor: 190000, interests: ['SURF', 'ADVENTURE', 'DINING'], preferredTransport: ['MOTO', 'BOAT'],
    intakeCompleted: true,
  },
  {
    firstName: 'Grace', lastName: 'Mutua', email: 'grace.mutua@example.com', phone: '+254 700 000018',
    locale: 'EN', countryCode: 'KE', partySize: 1, surfAbility: 'BEGINNER', pace: 'RELAXED',
    budgetPerDayMinor: 100000, interests: ['CULTURE', 'DINING'], preferredTransport: ['WALK', 'SHUTTLE'],
    mobilityNotes: 'Prefers to avoid boats', intakeCompleted: true,
  },
  {
    firstName: 'Tobias', lastName: 'Reuter', email: 'tobias.reuter@example.com', phone: '+43 660 0000019',
    locale: 'EN', countryCode: 'AT', partySize: 2, surfAbility: null, pace: null,
    budgetPerDayMinor: null, interests: [], preferredTransport: [],
    intakeCompleted: false,
  },
  {
    firstName: 'Valentina', lastName: 'Ríos', email: 'valentina.rios@example.com', phone: '+56 9 0000 0020',
    locale: 'ES', countryCode: 'CL', partySize: 2, surfAbility: null, pace: null,
    budgetPerDayMinor: null, interests: [], preferredTransport: [],
    intakeCompleted: false,
  },
]
