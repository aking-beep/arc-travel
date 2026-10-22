export type CultureGuide = {
  destination: string
  intro: string
  etiquette: { title: string; text: string }[]
  traditions: { title: string; text: string }[]
  language: { phrase: string; meaning: string; say: string }[]
  responsible: string[]
  customs: string[]
  safety: string[]
  seasons: { months: string; label: string; text: string }[]
  community: string[]
  faq: { q: string; a: string }[]
}

const generic = (destination: string, name: string, lang: { phrase: string; meaning: string; say: string }[]): CultureGuide => ({
  destination,
  intro: `${name} has its own rhythms. A few small gestures go a long way toward travelling as a guest rather than a spectator.`,
  etiquette: [
    { title: 'Greet first', text: 'Say hello before asking a question in shops, taxis and markets.' },
    { title: 'Dress for context', text: 'Beachwear belongs on the beach. Cover up in religious sites and villages.' },
    { title: 'Ask before photos', text: 'Always ask before photographing people, ceremonies or homes.' },
  ],
  traditions: [{ title: 'Local festivals', text: 'Check the calendar — festivals can close businesses and fill accommodation.' }],
  language: lang,
  responsible: ['Choose locally owned stays and guides', 'Carry a refillable bottle', 'Stay on marked trails'],
  customs: ['Tipping norms vary — ask your host', 'Meal times may be later than you expect'],
  safety: ['Use registered transport at night', 'Keep copies of travel documents', 'Buy travel insurance'],
  seasons: [{ months: 'Peak', label: 'Busy', text: 'Book stays and guides early.' }, { months: 'Shoulder', label: 'Ideal', text: 'Fewer crowds, good weather.' }],
  community: ['Book experiences led by residents', 'Shop at markets rather than chains'],
  faq: [
    { q: 'Is tipping expected?', a: `Tipping customs in ${name} vary by service. Your host or guide can advise — around 10% in restaurants is a common starting point where service is not included.` },
    { q: 'What should I wear?', a: 'Light, modest layers. Cover shoulders and knees at religious sites.' },
    { q: 'Is the tap water safe?', a: 'Ask your accommodation. When in doubt, use filtered water and a refillable bottle.' },
  ],
})

export const cultureGuides: CultureGuide[] = [
  {
    destination: 'puerto-escondido',
    intro: 'Puerto Escondido sits within Oaxaca, one of Mexico’s most culturally diverse states, home to sixteen Indigenous peoples. The coast is relaxed, but the culture runs deep — in food, in language and in community life.',
    etiquette: [
      { title: 'Greet everyone', text: 'A “buenos días” or “buenas tardes” when entering a shop, taxi or colectivo is expected. Skipping it reads as rude.' },
      { title: 'Respect the line-up', text: 'Zicatela and La Punta have local surfers who have paddled there all their lives. Wait your turn, don’t drop in, and give way to locals.' },
      { title: 'Dress off the beach', text: 'Swimwear is for the sand. Put on a shirt to walk through town, the market or El Adoquín.' },
      { title: 'Bargain gently', text: 'Light bargaining is fine at craft stalls, never for food or at fixed-price shops. Artisans set fair prices for hours of work.' },
    ],
    traditions: [
      { title: 'Guelaguetza', text: 'In July, communities across Oaxaca celebrate with dance, music and shared food. Smaller versions take place on the coast.' },
      { title: 'Día de Muertos', text: 'From 31 October to 2 November, families build altars with marigolds, pan de muerto and photographs to welcome back the dead. Visitors are welcome to observe respectfully.' },
      { title: 'Mezcal ritual', text: 'Mezcal is sipped, not shot — traditionally with orange slices and sal de gusano. Saying “¡Para todo mal, mezcal!” is a classic toast.' },
      { title: 'Turtle season', text: 'Olive ridley turtles nest from June to December. Community camps release hatchlings at sunset.' },
    ],
    language: [
      { phrase: 'Buenos días', meaning: 'Good morning', say: 'BWEH-nohs DEE-ahs' },
      { phrase: '¿Cuánto cuesta?', meaning: 'How much is it?', say: 'KWAN-toh KWES-tah' },
      { phrase: 'Con permiso', meaning: 'Excuse me (passing)', say: 'kohn pehr-MEE-soh' },
      { phrase: '¿Hay corriente?', meaning: 'Is there a current/rip?', say: 'eye koh-ree-EN-teh' },
      { phrase: 'Muy amable', meaning: 'Very kind of you', say: 'mwee ah-MAH-bleh' },
      { phrase: 'Padiuxi', meaning: 'Hello (Zapotec)', say: 'pah-dee-OO-shee' },
    ],
    responsible: [
      'Stay in locally owned lodges in La Punta and Rinconada',
      'Never touch nesting turtles or hatchlings; use red light at night on beaches',
      'Bring reef-safe sunscreen and avoid using it before bioluminescence swims',
      'Carry cash for small vendors — card fees hurt small businesses',
      'Respect water scarcity: take short showers in dry season',
    ],
    customs: [
      'Lunch (comida) is the main meal, usually 14:00–16:00',
      'Tipping: 10–15% in restaurants; round up for taxis is not required',
      '“Ahorita” can mean now, later, or never — patience helps',
      'Sundays are for family; some businesses close in the afternoon',
    ],
    safety: [
      'Zicatela is a heavy, dangerous wave — swim only at Carrizalillo, Manzanillo or Puerto Angelito',
      'Agree taxi fares before getting in',
      'Avoid isolated beaches after dark',
      'Earthquakes are possible — note exits in your accommodation',
      'Drink filtered or bottled water',
    ],
    seasons: [
      { months: 'Nov – Apr', label: 'Dry & calm', text: 'Sunny, low humidity and smaller surf. Peak season — book stays early.' },
      { months: 'May – Jun', label: 'Swell builds', text: 'Hot, with big south swells arriving. Fewer visitors.' },
      { months: 'Jul – Oct', label: 'Rainy & green', text: 'Afternoon storms, lush jungle, best bioluminescence and turtle season. Hurricane risk Sep–Oct.' },
    ],
    community: [
      'Mangrove replanting with the Manialtepec cooperative',
      'Turtle releases with Vive Mar conservation camp',
      'Cooking in a family kitchen with Doña Rosa',
      'Buying directly from Mixtec weavers at the Sunday market',
    ],
    faq: [
      { q: 'Is it safe to swim at Zicatela?', a: 'No — Zicatela has powerful shore break and strong rips. It is suitable only for experienced surfers. Swim at Playa Carrizalillo, Playa Manzanillo or Puerto Angelito, which are sheltered coves.' },
      { q: 'Do I need to speak Spanish?', a: 'Not strictly — many people in tourism speak English — but basic greetings are appreciated and expected. In surrounding villages, Zapotec or Mixtec may be the first language.' },
      { q: 'How much should I tip?', a: 'Around 10–15% in sit-down restaurants. Surf instructors and guides appreciate MXN 100–200 per person for a half day. Taxis do not expect tips.' },
      { q: 'Can I pay by card?', a: 'Increasingly in Rinconada and Zicatela, but La Punta and the markets are mostly cash. Carry pesos in small notes.' },
      { q: 'What should I wear?', a: 'Light linen and cotton. Put a shirt on when leaving the beach, and bring a light layer for air-conditioned buses and evenings in winter.' },
      { q: 'Is the tap water drinkable?', a: 'No. Use filtered water — most lodges provide garrafones (large refill jugs) so you can avoid plastic bottles.' },
      { q: 'When is turtle season?', a: 'Olive ridley turtles nest June to December. Releases happen at sunset at community camps; never use flash photography.' },
    ],
  },
  generic('mexico-city', 'Mexico City', [{ phrase: 'Buenas tardes', meaning: 'Good afternoon', say: 'BWEH-nahs TAR-dehs' }, { phrase: 'La cuenta, por favor', meaning: 'The bill, please', say: 'lah KWEN-tah' }, { phrase: '¿Está picante?', meaning: 'Is it spicy?', say: 'es-TAH pee-KAHN-teh' }]),
  generic('lombok', 'Lombok', [{ phrase: 'Selamat pagi', meaning: 'Good morning', say: 'seh-LAH-mat PAH-gee' }, { phrase: 'Terima kasih', meaning: 'Thank you', say: 'teh-REE-mah KAH-see' }, { phrase: 'Tampi asih', meaning: 'Thank you (Sasak)', say: 'TAM-pee AH-see' }]),
  generic('bali', 'Bali', [{ phrase: 'Om swastiastu', meaning: 'Hindu greeting', say: 'om swas-tee-AS-too' }, { phrase: 'Suksma', meaning: 'Thank you (Balinese)', say: 'SOOK-smah' }, { phrase: 'Berapa?', meaning: 'How much?', say: 'beh-RAH-pah' }]),
  generic('lisbon', 'Lisbon', [{ phrase: 'Bom dia', meaning: 'Good morning', say: 'bohn DEE-ah' }, { phrase: 'Obrigado/a', meaning: 'Thank you', say: 'oh-bree-GAH-doo' }, { phrase: 'Com licença', meaning: 'Excuse me', say: 'kohn lee-SEN-sah' }]),
  generic('ericeira', 'Ericeira', [{ phrase: 'Bom dia', meaning: 'Good morning', say: 'bohn DEE-ah' }, { phrase: 'Obrigado/a', meaning: 'Thank you', say: 'oh-bree-GAH-doo' }, { phrase: 'Está bom o mar?', meaning: 'Is the sea good?', say: 'esh-TAH bohn oo mar' }]),
  generic('chamonix', 'Chamonix', [{ phrase: 'Bonjour', meaning: 'Hello', say: 'bohn-ZHOOR' }, { phrase: 'Merci', meaning: 'Thank you', say: 'mehr-SEE' }, { phrase: 'Au secours', meaning: 'Help', say: 'oh suh-KOOR' }]),
  generic('cape-town', 'Cape Town', [{ phrase: 'Molo', meaning: 'Hello (isiXhosa)', say: 'MOH-loh' }, { phrase: 'Dankie', meaning: 'Thank you (Afrikaans)', say: 'DUN-kee' }, { phrase: 'Enkosi', meaning: 'Thank you (isiXhosa)', say: 'en-KOH-see' }]),
]

export const getCulture = (slug?: string) => cultureGuides.find((c) => c.destination === slug)
