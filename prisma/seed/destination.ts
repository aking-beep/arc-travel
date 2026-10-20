/**
 * Puerto Escondido destination graph fixtures.
 *
 * The coordinates, names and general character of these places are real public
 * geography — Zicatela really is a heavy, advanced-only beach break and
 * Carrizalillo really is a sheltered cove. Everything commercial (suppliers,
 * availability, prices, certifications) is invented, and every row is written
 * with `provenance: SEED_FIXTURE` and `verification: UNVERIFIED` so the product
 * cannot present fixture data as a verified fact.
 *
 * `typicalRisk` is baseline character, not a forecast. Day-level readings live
 * in ConditionReport and always carry their own `observedAt`.
 */
export interface PlaceFixture {
  slug: string
  name: string
  kind:
    | 'BEACH'
    | 'SURF_BREAK'
    | 'NEIGHBORHOOD'
    | 'VIEWPOINT'
    | 'LAGOON'
    | 'MARKET'
    | 'DINING_DISTRICT'
    | 'STUDIO'
    | 'TRANSPORT_HUB'
  parentSlug?: string
  latitude: number
  longitude: number
  summaryEn: string
  summaryEs: string
  typicalRisk: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME'
  safetyNotesEn?: string
  safetyNotesEs?: string
  /** Whether day-level ocean condition reports are generated for this place. */
  oceanConditions: boolean
}

export const PLACES: PlaceFixture[] = [
  {
    slug: 'la-rinconada',
    name: 'La Rinconada',
    kind: 'NEIGHBORHOOD',
    latitude: 15.865,
    longitude: -97.083,
    summaryEn:
      'Quiet residential hillside above the western coves. Walkable to Carrizalillo, a short taxi from the centre.',
    summaryEs:
      'Ladera residencial tranquila sobre las calas del oeste. Se camina a Carrizalillo y queda a un taxi corto del centro.',
    typicalRisk: 'LOW',
    oceanConditions: false,
  },
  {
    slug: 'centro-adoquin',
    name: 'Centro / El Adoquín',
    kind: 'DINING_DISTRICT',
    latitude: 15.8647,
    longitude: -97.0708,
    summaryEn:
      'The old pedestrian strip behind Playa Principal. Market stalls, mezcalerías and the bulk of the town’s kitchens.',
    summaryEs:
      'El andador peatonal detrás de Playa Principal. Puestos de mercado, mezcalerías y la mayoría de las cocinas del pueblo.',
    typicalRisk: 'LOW',
    oceanConditions: false,
  },
  {
    slug: 'playa-zicatela',
    name: 'Playa Zicatela',
    kind: 'SURF_BREAK',
    parentSlug: 'zicatela-barrio',
    latitude: 15.8505,
    longitude: -97.0525,
    summaryEn:
      'The Mexican Pipeline: a heavy, fast beach break that holds serious size. An experienced-surfer wave, not a swimming beach.',
    summaryEs:
      'El Mexican Pipeline: un beach break pesado y rápido que aguanta tamaño serio. Una ola para surfistas con experiencia, no una playa para nadar.',
    typicalRisk: 'EXTREME',
    safetyNotesEn:
      'Powerful shore break and persistent rip currents. Not suitable for beginners or for casual swimming at any size. Lifeguards operate limited hours.',
    safetyNotesEs:
      'Rompiente fuerte en la orilla y corrientes de retorno persistentes. No apto para principiantes ni para nadar de forma casual, sea cual sea el tamaño. Los salvavidas operan en horarios limitados.',
    oceanConditions: true,
  },
  {
    slug: 'zicatela-barrio',
    name: 'Zicatela',
    kind: 'NEIGHBORHOOD',
    latitude: 15.8528,
    longitude: -97.0565,
    summaryEn:
      'The surf strip: board shops, cafés and hostels along one long road parallel to the beach.',
    summaryEs:
      'La franja del surf: tiendas de tablas, cafés y hostales a lo largo de una calle paralela a la playa.',
    typicalRisk: 'LOW',
    oceanConditions: false,
  },
  {
    slug: 'la-punta-zicatela',
    name: 'La Punta Zicatela',
    kind: 'SURF_BREAK',
    parentSlug: 'zicatela-barrio',
    latitude: 15.8392,
    longitude: -97.0391,
    summaryEn:
      'The left-hand point at the southern end of Zicatela. Longer, more forgiving walls than the beach break, and the usual place to progress past the beginner stage.',
    summaryEs:
      'La punta izquierda en el extremo sur de Zicatela. Paredes más largas y menos castigadoras que el beach break, y el lugar habitual para progresar más allá del nivel principiante.',
    typicalRisk: 'HIGH',
    safetyNotesEn:
      'Crowded line-up with a rocky entry and a strong current running down the point on bigger swells. Go with someone who knows the entry.',
    safetyNotesEs:
      'Line-up concurrido con entrada rocosa y una corriente fuerte que corre por la punta con marejadas grandes. Entra con alguien que conozca el acceso.',
    oceanConditions: true,
  },
  {
    slug: 'playa-carrizalillo',
    name: 'Playa Carrizalillo',
    kind: 'BEACH',
    parentSlug: 'la-rinconada',
    latitude: 15.8617,
    longitude: -97.0797,
    summaryEn:
      'A small sheltered cove reached by a long stairway. Gentler water than the open beaches — the usual place for first surf lessons and for snorkelling.',
    summaryEs:
      'Una pequeña cala protegida a la que se baja por una escalera larga. Agua más suave que las playas abiertas: el lugar habitual para las primeras clases de surf y para esnorquelear.',
    typicalRisk: 'LOW',
    safetyNotesEn:
      'The cove is sheltered but not flat: the shore break can still knock you down, and the stairway is steep with roughly 160 steps.',
    safetyNotesEs:
      'La cala está protegida pero no es plana: la rompiente de orilla todavía puede tumbarte, y la escalera es empinada, con unos 160 escalones.',
    oceanConditions: true,
  },
  {
    slug: 'playa-principal',
    name: 'Playa Principal',
    kind: 'BEACH',
    parentSlug: 'centro-adoquin',
    latitude: 15.8594,
    longitude: -97.0689,
    summaryEn:
      'The town beach and working harbour. Pangas launch from here for boat tours, and the fishermen land the morning catch on the sand.',
    summaryEs:
      'La playa del pueblo y el puerto de trabajo. Desde aquí salen las lanchas para los paseos en barco, y los pescadores desembarcan la pesca de la mañana en la arena.',
    typicalRisk: 'LOW',
    safetyNotesEn:
      'Active boat traffic at the eastern end. Stay inside the swimming area markers and clear of the panga channel.',
    safetyNotesEs:
      'Tráfico activo de lanchas en el extremo este. Permanece dentro de los marcadores de la zona de nado y lejos del canal de pangas.',
    oceanConditions: true,
  },
  {
    slug: 'puerto-angelito',
    name: 'Puerto Angelito',
    kind: 'BEACH',
    parentSlug: 'la-rinconada',
    latitude: 15.8617,
    longitude: -97.0745,
    summaryEn:
      'Twin shallow coves between Principal and Carrizalillo, busy with day-trippers and seafood palapas.',
    summaryEs:
      'Dos calas poco profundas entre Principal y Carrizalillo, con mucho visitante de día y palapas de mariscos.',
    typicalRisk: 'LOW',
    oceanConditions: true,
  },
  {
    slug: 'playa-bacocho',
    name: 'Playa Bacocho',
    kind: 'BEACH',
    latitude: 15.8711,
    longitude: -97.0877,
    summaryEn:
      'A long, open west-facing beach. Known for sunsets and for the turtle-release programme rather than for swimming.',
    summaryEs:
      'Una playa larga y abierta orientada al oeste. Conocida por los atardeceres y por el programa de liberación de tortugas más que por nadar.',
    typicalRisk: 'HIGH',
    safetyNotesEn:
      'Heavy shore dump and strong rip currents along most of its length. Treat it as a walking and sunset beach.',
    safetyNotesEs:
      'Rompiente fuerte en la orilla y corrientes de retorno intensas en casi toda su extensión. Tómala como playa para caminar y ver el atardecer.',
    oceanConditions: true,
  },
  {
    slug: 'laguna-manialtepec',
    name: 'Laguna de Manialtepec',
    kind: 'LAGOON',
    latitude: 15.923,
    longitude: -97.208,
    summaryEn:
      'A brackish coastal lagoon about 25 km west of town, fringed with mangrove. Birds at dawn, bioluminescent plankton on dark nights.',
    summaryEs:
      'Una laguna costera salobre a unos 25 km al oeste del pueblo, bordeada de manglar. Aves al amanecer, plancton bioluminiscente en noches oscuras.',
    typicalRisk: 'LOW',
    safetyNotesEn:
      'Bioluminescence depends on the moon phase and recent rain, so it genuinely cannot be guaranteed on a given night.',
    safetyNotesEs:
      'La bioluminiscencia depende de la fase lunar y de las lluvias recientes, así que de verdad no se puede garantizar en una noche concreta.',
    oceanConditions: false,
  },
  {
    slug: 'mercado-benito-juarez',
    name: 'Mercado Benito Juárez',
    kind: 'MARKET',
    parentSlug: 'centro-adoquin',
    latitude: 15.868,
    longitude: -97.0689,
    summaryEn:
      'The town market. Produce, dried chiles, cheese and the comedor stalls at the back.',
    summaryEs:
      'El mercado del pueblo. Verdura, chiles secos, quesillo y los puestos de comedor al fondo.',
    typicalRisk: 'LOW',
    oceanConditions: false,
  },
  {
    slug: 'aeropuerto-pxm',
    name: 'Puerto Escondido Airport (PXM)',
    kind: 'TRANSPORT_HUB',
    latitude: 15.8769,
    longitude: -97.0896,
    summaryEn: 'Single-runway regional airport, roughly 10 minutes from the western neighbourhoods.',
    summaryEs:
      'Aeropuerto regional de una pista, a unos 10 minutos de los barrios del oeste.',
    typicalRisk: 'LOW',
    oceanConditions: false,
  },
  {
    slug: 'mirador-cerro-del-tigre',
    name: 'Mirador Cerro del Tigre',
    kind: 'VIEWPOINT',
    parentSlug: 'la-rinconada',
    latitude: 15.8669,
    longitude: -97.0812,
    summaryEn: 'Short walk up to an open view over the western coves and the sunset line.',
    summaryEs:
      'Caminata corta hasta una vista abierta sobre las calas del oeste y la línea del atardecer.',
    typicalRisk: 'LOW',
    oceanConditions: false,
  },
]

/**
 * One-way travel times, in minutes, measured as a local would quote them.
 * Reverse directions are generated automatically; walking edges are only
 * declared where a walk is actually plausible.
 */
export interface TravelFixture {
  from: string
  to: string
  mode: 'WALK' | 'TAXI' | 'SHUTTLE' | 'MOTO' | 'BOAT'
  minutes: number
  distanceKm: number
  /** One-way cost in centavos. */
  costMinor: number
}

export const TRAVEL_EDGES: TravelFixture[] = [
  { from: 'la-rinconada', to: 'playa-carrizalillo', mode: 'WALK', minutes: 9, distanceKm: 0.6, costMinor: 0 },
  { from: 'la-rinconada', to: 'mirador-cerro-del-tigre', mode: 'WALK', minutes: 12, distanceKm: 0.8, costMinor: 0 },
  { from: 'la-rinconada', to: 'puerto-angelito', mode: 'WALK', minutes: 16, distanceKm: 1.1, costMinor: 0 },
  { from: 'la-rinconada', to: 'playa-principal', mode: 'TAXI', minutes: 8, distanceKm: 2.1, costMinor: 7000 },
  { from: 'la-rinconada', to: 'centro-adoquin', mode: 'TAXI', minutes: 8, distanceKm: 2.0, costMinor: 7000 },
  { from: 'la-rinconada', to: 'playa-bacocho', mode: 'TAXI', minutes: 7, distanceKm: 1.8, costMinor: 7000 },
  { from: 'la-rinconada', to: 'playa-zicatela', mode: 'TAXI', minutes: 14, distanceKm: 4.3, costMinor: 10000 },
  { from: 'la-rinconada', to: 'la-punta-zicatela', mode: 'TAXI', minutes: 20, distanceKm: 6.1, costMinor: 15000 },
  { from: 'la-rinconada', to: 'zicatela-barrio', mode: 'TAXI', minutes: 15, distanceKm: 4.6, costMinor: 12000 },
  { from: 'la-rinconada', to: 'aeropuerto-pxm', mode: 'TAXI', minutes: 10, distanceKm: 2.6, costMinor: 9000 },
  { from: 'la-rinconada', to: 'laguna-manialtepec', mode: 'SHUTTLE', minutes: 40, distanceKm: 24.0, costMinor: 25000 },
  { from: 'la-rinconada', to: 'mercado-benito-juarez', mode: 'TAXI', minutes: 9, distanceKm: 2.2, costMinor: 7000 },
  { from: 'playa-carrizalillo', to: 'puerto-angelito', mode: 'WALK', minutes: 14, distanceKm: 0.9, costMinor: 0 },
  { from: 'playa-carrizalillo', to: 'playa-principal', mode: 'TAXI', minutes: 9, distanceKm: 2.4, costMinor: 7000 },
  { from: 'playa-carrizalillo', to: 'la-punta-zicatela', mode: 'TAXI', minutes: 22, distanceKm: 6.4, costMinor: 15000 },
  { from: 'playa-carrizalillo', to: 'playa-zicatela', mode: 'TAXI', minutes: 16, distanceKm: 4.6, costMinor: 12000 },
  { from: 'playa-carrizalillo', to: 'laguna-manialtepec', mode: 'SHUTTLE', minutes: 42, distanceKm: 24.5, costMinor: 25000 },
  { from: 'centro-adoquin', to: 'playa-principal', mode: 'WALK', minutes: 4, distanceKm: 0.3, costMinor: 0 },
  { from: 'centro-adoquin', to: 'mercado-benito-juarez', mode: 'WALK', minutes: 11, distanceKm: 0.8, costMinor: 0 },
  { from: 'centro-adoquin', to: 'playa-zicatela', mode: 'TAXI', minutes: 10, distanceKm: 2.6, costMinor: 7000 },
  { from: 'centro-adoquin', to: 'la-punta-zicatela', mode: 'TAXI', minutes: 15, distanceKm: 4.4, costMinor: 12000 },
  { from: 'playa-principal', to: 'playa-zicatela', mode: 'WALK', minutes: 22, distanceKm: 1.6, costMinor: 0 },
  { from: 'playa-principal', to: 'laguna-manialtepec', mode: 'BOAT', minutes: 55, distanceKm: 26.0, costMinor: 45000 },
  { from: 'playa-zicatela', to: 'la-punta-zicatela', mode: 'WALK', minutes: 26, distanceKm: 1.9, costMinor: 0 },
  { from: 'playa-zicatela', to: 'zicatela-barrio', mode: 'WALK', minutes: 3, distanceKm: 0.2, costMinor: 0 },
  { from: 'zicatela-barrio', to: 'la-punta-zicatela', mode: 'TAXI', minutes: 8, distanceKm: 2.1, costMinor: 7000 },
  { from: 'playa-bacocho', to: 'aeropuerto-pxm', mode: 'TAXI', minutes: 5, distanceKm: 1.3, costMinor: 7000 },
  { from: 'playa-bacocho', to: 'centro-adoquin', mode: 'TAXI', minutes: 10, distanceKm: 2.9, costMinor: 7000 },
]
