/**
 * Editorial destination guidance.
 *
 * This is ARC's own writing, not a sourced legal record, and the type says so.
 * `modules/culture-context` is the sourced path: it reads a government
 * advisory, labels it ADVISORY, and refuses to let an advisory be rendered as
 * law (ADR-024). Nothing in this file may claim that standing, so:
 *
 *   * the export's `safety` array is `advisories` here, and the UI labels it
 *     as editorial guidance rather than assurance (non-negotiables 1 and 8);
 *   * every guide carries `reviewedAt`, so a reader can see how old the
 *     writing is;
 *   * anything about the state of the ocean points at the dated readings on
 *     the local guide instead of asserting a condition that changes daily.
 */
/**
 * The phrase groups a language section is organised under.
 *
 * Three phrases in a row needed no structure. A traveller who wants to order
 * a meal, apologise for their Spanish and ask where the bus goes does, and
 * scanning twelve ungrouped lines for the one they need is the reason phrase
 * books have tabs.
 */
export const LANGUAGE_GROUPS = ['Greetings', 'Courtesy', 'Getting by', 'Eating', 'Help'] as const

export type LanguageGroup = (typeof LANGUAGE_GROUPS)[number]

export type LanguageLine = {
  phrase: string
  meaning: string
  /** A rough English-reader pronunciation. Not IPA: it is for saying out loud. */
  say: string
  group: LanguageGroup
}

export type CultureGuide = {
  destination: string
  /** ISO date the prose was last read through. Shown to the reader. */
  reviewedAt: string
  intro: string
  etiquette: { title: string; text: string }[]
  traditions: { title: string; text: string }[]
  language: LanguageLine[]
  responsible: string[]
  customs: string[]
  advisories: string[]
  seasons: { months: string; label: string; text: string }[]
  community: string[]
  faq: { q: string; a: string }[]
}

/*
 * There is no `generic()` helper any more.
 *
 * Seven of the eight guides were built from one, so Chamonix, Lisbon, Bali,
 * Lombok, Mexico City, Ericeira and Cape Town shipped byte-identical
 * etiquette, traditions, customs, advisories, seasons, responsible-tourism
 * notes and FAQ, with the name interpolated and three phrases swapped. The
 * result told a visitor to Chamonix that "beachwear belongs on the beach" and
 * that their peak season was "Busy".
 *
 * Each guide is now written for its own place. The constraints are the same
 * ones the type was always under: this is ARC's editorial writing, not a
 * sourced legal record (non-negotiable 8 and ADR-024), nothing here asserts
 * that anything is safe (non-negotiable 1), and anything that changes by the
 * hour — the state of the sea, the state of a mountain — points at the dated
 * readings rather than claiming a condition.
 */

export const cultureGuides: CultureGuide[] = [
  {
    destination: 'puerto-escondido',
    reviewedAt: '2026-10-22',
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
      { phrase: 'Buenos días', meaning: 'Good morning', say: 'BWEH-nohs DEE-ahs', group: 'Greetings' },
      { phrase: 'Buenas tardes', meaning: 'Good afternoon', say: 'BWEH-nahs TAR-dehs', group: 'Greetings' },
      { phrase: 'Padiuxi', meaning: 'Hello (Zapotec)', say: 'pah-dee-OO-shee', group: 'Greetings' },
      { phrase: 'Por favor / Gracias', meaning: 'Please / Thank you', say: 'por fah-VOR / GRAH-syahs', group: 'Courtesy' },
      { phrase: 'Con permiso', meaning: 'Excuse me (passing)', say: 'kohn pehr-MEE-soh', group: 'Courtesy' },
      { phrase: 'Muy amable', meaning: 'Very kind of you', say: 'mwee ah-MAH-bleh', group: 'Courtesy' },
      { phrase: '¿Cuánto cuesta?', meaning: 'How much is it?', say: 'KWAN-toh KWES-tah', group: 'Getting by' },
      { phrase: '¿Me da un garrafón?', meaning: 'Can I have a water refill?', say: 'meh dah oon gah-rrah-FOHN', group: 'Getting by' },
      { phrase: 'La cuenta, por favor', meaning: 'The bill, please', say: 'lah KWEN-tah', group: 'Eating' },
      { phrase: '¿Está picante?', meaning: 'Is it spicy?', say: 'es-TAH pee-KAHN-teh', group: 'Eating' },
      { phrase: '¿Hay corriente?', meaning: 'Is there a current or rip?', say: 'eye koh-ree-EN-teh', group: 'Help' },
      { phrase: '¡Ayuda!', meaning: 'Help!', say: 'ah-YOO-dah', group: 'Help' },
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
    advisories: [
      'Zicatela is an exposed beach break with a heavy shore dump; the sheltered coves are Carrizalillo, Manzanillo and Puerto Angelito. Check the dated readings on the local guide rather than treating this line as current.',
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
      { q: 'Can I swim at Zicatela?', a: 'ARC will not tell you a beach is safe, and nobody should: the water changes by the hour. What we can tell you is that Zicatela is an exposed beach break with a heavy shore dump and strong rips, that the sheltered coves — Carrizalillo, Manzanillo and Puerto Angelito — are where the swimming and the beginner lessons happen, and that the local guide carries the most recent reading we have for each of them with the time it was taken. Read it, then ask a lifeguard.' },
      { q: 'Do I need to speak Spanish?', a: 'Not strictly — many people in tourism speak English — but basic greetings are appreciated and expected. In surrounding villages, Zapotec or Mixtec may be the first language.' },
      { q: 'How much should I tip?', a: 'Around 10–15% in sit-down restaurants. Surf instructors and guides appreciate MXN 100–200 per person for a half day. Taxis do not expect tips.' },
      { q: 'Can I pay by card?', a: 'Increasingly in Rinconada and Zicatela, but La Punta and the markets are mostly cash. Carry pesos in small notes.' },
      { q: 'What should I wear?', a: 'Light linen and cotton. Put a shirt on when leaving the beach, and bring a light layer for air-conditioned buses and evenings in winter.' },
      { q: 'Is the tap water drinkable?', a: 'No. Use filtered water — most lodges provide garrafones (large refill jugs) so you can avoid plastic bottles.' },
      { q: 'When is turtle season?', a: 'Olive ridley turtles nest June to December. Releases happen at sunset at community camps; never use flash photography.' },
    ],
  },
  {
    destination: 'mexico-city',
    reviewedAt: '2026-10-29',
    intro:
      'Mexico City is built on a drained lake, at 2,240 metres, over the ruins of Tenochtitlan — and it behaves like several cities at once. Roma and Condesa are leafy and slow; the Centro Histórico is dense, loud and the oldest part of the continent’s oldest continuously inhabited capital. Nothing about it is a beach town, and the altitude is the first thing most visitors underestimate.',
    etiquette: [
      { title: 'Greet the room', text: 'A “buenos días” on entering a shop, a lift or a waiting room is normal and its absence is noticed. Among friends, a single kiss on the right cheek.' },
      { title: 'Use usted first', text: 'Address anyone older, anyone serving you and anyone you have just met as “usted”. Being invited to tutear is a small kindness; assuming it is not.' },
      { title: 'Do not rush a meal', text: 'The bill is never brought until you ask. Sitting on after eating is the point, and a waiter clearing you out would be the rude one.' },
      { title: 'Ask before photographing', text: 'Especially in markets, in churches and at the Zócalo’s dancers and protests. A market stall is somebody’s business, not a backdrop.' },
    ],
    traditions: [
      { title: 'Día de Muertos', text: '31 October to 2 November. Families build ofrendas with marigolds, water, salt and photographs. The city’s parade is a recent invention — the altars are the old thing, and the ones in Coyoacán and Mixquic are where to see them.' },
      { title: 'Sunday in Chapultepec', text: 'Museums are free to residents on Sundays and the park fills. Reforma closes to cars until early afternoon and the whole avenue is bicycles.' },
      { title: 'Lucha libre', text: 'Friday nights at Arena México. Masks are not costume: a luchador’s mask is their identity and buying one is fine, mocking one is not.' },
      { title: 'Las mañanitas', text: 'The birthday song, sung at midnight, often with the cake and often by the whole restaurant. If it starts, stop talking.' },
    ],
    language: [
      { phrase: 'Buenos días', meaning: 'Good morning', say: 'BWEH-nohs DEE-ahs', group: 'Greetings' },
      { phrase: 'Buenas tardes', meaning: 'Good afternoon (after ~13:00)', say: 'BWEH-nahs TAR-dehs', group: 'Greetings' },
      { phrase: 'Mucho gusto', meaning: 'Pleased to meet you', say: 'MOO-choh GOOS-toh', group: 'Greetings' },
      { phrase: 'Por favor / Gracias', meaning: 'Please / Thank you', say: 'por fah-VOR / GRAH-syahs', group: 'Courtesy' },
      { phrase: 'Con permiso', meaning: 'Excuse me (passing, leaving)', say: 'kohn pehr-MEE-soh', group: 'Courtesy' },
      { phrase: 'Disculpe', meaning: 'Excuse me (getting attention)', say: 'dees-KOOL-peh', group: 'Courtesy' },
      { phrase: 'No hablo mucho español', meaning: 'I do not speak much Spanish', say: 'noh AH-bloh MOO-choh es-pah-NYOL', group: 'Getting by' },
      { phrase: '¿Cuánto cuesta?', meaning: 'How much is it?', say: 'KWAN-toh KWES-tah', group: 'Getting by' },
      { phrase: '¿Me cobra, por favor?', meaning: 'The bill, please', say: 'meh KOH-brah por fah-VOR', group: 'Eating' },
      { phrase: '¿Está muy picante?', meaning: 'Is it very spicy?', say: 'es-TAH mwee pee-KAHN-teh', group: 'Eating' },
      { phrase: 'Para llevar', meaning: 'To take away', say: 'PAH-rah yeh-VAR', group: 'Eating' },
      { phrase: 'Necesito ayuda', meaning: 'I need help', say: 'neh-seh-SEE-toh ah-YOO-dah', group: 'Help' },
      { phrase: '¿Dónde está el baño?', meaning: 'Where is the toilet?', say: 'DOHN-deh es-TAH el BAH-nyoh', group: 'Help' },
    ],
    responsible: [
      'Stay in Roma, Condesa, Juárez or Coyoacán rather than short-let blocks that have pushed rents up fastest',
      'Eat at the fondas and markets, not only the tasting menus — the city’s food culture is mostly at the cheaper end',
      'Carry cash in small notes; street stalls and markets rarely take cards and the fees hurt them',
      'Use the Metro and Ecobici instead of ride-hailing for short trips; the traffic is the city’s worst environmental problem',
      'The valley is short of water. Showers here are not the place to linger',
    ],
    customs: [
      'Comida, the main meal, runs roughly 14:00–17:00. Dinner is late and light',
      'Tipping is 10–15% in restaurants, and a few pesos for the person who bags your shopping',
      '“Ahorita” means anything from right now to never. It is not a time',
      'Many museums close on Mondays, including Frida Kahlo’s Casa Azul and the Anthropology Museum',
      'Bargaining is for markets and crafts, never for food or in shops with marked prices',
    ],
    advisories: [
      'The altitude is 2,240 m. Most people feel it for two or three days — go slowly, drink more water than usual and go easy on alcohol the first night',
      'Air quality varies; the city issues its own contingency alerts in the dry months, which is the thing to read rather than this line',
      'Use registered taxis from a sitio or an app rather than hailing on the street, and keep phones out of sight on the Metro at rush hour',
      'Earthquakes happen. Note where the stairs and the safe zones are wherever you are staying — the alarm sounds before the shaking and the drill is practised citywide every September',
      'Tap water is not drunk. Every kitchen uses filtered or garrafón water, and the ice in reputable places is made from it',
    ],
    seasons: [
      { months: 'Nov – Feb', label: 'Dry & clear', text: 'Bright days around 22°C, cold nights near freezing, and the clearest views of the volcanoes. Most rooms have no heating — bring a layer.' },
      { months: 'Mar – May', label: 'Hot & hazy', text: 'The warmest and the most polluted stretch, before the rains break it. Jacaranda season turns the city purple in late March.' },
      { months: 'Jun – Oct', label: 'Rainy', text: 'Mornings are usually fine and the rain arrives hard in the late afternoon. Green, cheaper, and the city at its best if you plan around the clock.' },
    ],
    community: [
      'Alebrije painting with a family workshop rather than a tourist studio',
      'Market tours in Mercado de Medellín or San Juan led by the traders themselves',
      'Chinampa farming at Xochimilco with the growers restoring the lake beds',
      'Buying crafts direct at the Ciudadela from the makers rather than resellers',
    ],
    faq: [
      { q: 'Is the altitude really a problem?', a: 'For most people it is two or three days of being slightly out of breath on stairs and sleeping badly the first night. Drink more water than feels necessary, eat lightly and leave the serious walking until day three. If you have a heart or lung condition, that is a conversation with your own doctor before you come, not with us.' },
      { q: 'Do I need Spanish?', a: 'You will get by in Roma, Condesa and the museums without it. Outside those, much less so. A dozen phrases and a translation app covers almost everything, and the attempt is received warmly.' },
      { q: 'How much should I tip?', a: '10–15% in sit-down restaurants and it is often not included. A few pesos for the supermarket bagger, who is frequently an older person working for tips alone. Taxi drivers do not expect one.' },
      { q: 'Is it safe to walk around?', a: 'ARC does not tell anybody a place is safe. What is true and useful: Roma, Condesa, Juárez, Polanco and Coyoacán are busy and well-lit into the evening, the Centro empties after dark, and the ordinary advice about phones, jewellery and empty streets applies here as it does in any large city. Ask your hotel about the specific blocks around them — they know their own neighbourhood and we do not.' },
      { q: 'Can I drink the tap water?', a: 'No, and nobody local does. Hotels and restaurants use filtered or garrafón water; ask for a refill rather than buying bottles.' },
      { q: 'What about the spice?', a: 'The food is less uniformly hot than its reputation. The heat usually arrives in the salsas on the table, which is to say it is your decision. “¿Está muy picante?” is a normal question and nobody minds it.' },
      { q: 'Is it worth leaving the city?', a: 'Teotihuacan, Puebla and Tepoztlán are all comfortable day trips by bus, and the buses here are better than most people expect. Go early; Teotihuacan is brutal by midday.' },
    ],
  },
  {
    destination: 'lombok',
    reviewedAt: '2026-10-29',
    intro:
      'Lombok is Bali’s neighbour and almost nothing like it. It is predominantly Muslim, far quieter, and belongs to the Sasak people, whose language and adat — customary law — still order village life. The south coast has the surf and the new hotels; the north has Rinjani, an active volcano that is sacred to both Sasak and Balinese Hindus.',
    etiquette: [
      { title: 'Dress modestly away from the beach', text: 'Shoulders and knees covered in villages, markets and anywhere near a mosque. Swimwear belongs on the sand and nowhere else.' },
      { title: 'Use your right hand', text: 'Give, receive, eat and point with the right. The left is for washing and offering with it reads as an insult.' },
      { title: 'Take your shoes off', text: 'At the door of a home, a mosque and many small shops. Watch what everybody else has done.' },
      { title: 'Respect the call to prayer', text: 'Five times daily, loud, and starting before dawn. Lower your music, pause a conversation, and do not film people praying.' },
    ],
    traditions: [
      { title: 'Bau Nyale', text: 'In February or March, thousands gather at Seger beach before dawn to catch sea worms, following the legend of Princess Mandalika. It is the island’s biggest night.' },
      { title: 'Ramadan', text: 'A month of daylight fasting. Restaurants in Sasak villages may close until dusk; eating, drinking or smoking in the street during the day is poor form even for visitors.' },
      { title: 'Peresean', text: 'Ritual stick fighting with rattan canes and buffalo-hide shields, performed at festivals. Older than tourism and still taken seriously.' },
      { title: 'Rinjani as sacred ground', text: 'The crater lake Segara Anak receives offerings from both Sasak and Balinese pilgrims. A trek there is somebody else’s temple.' },
    ],
    language: [
      { phrase: 'Selamat pagi', meaning: 'Good morning', say: 'seh-LAH-mat PAH-gee', group: 'Greetings' },
      { phrase: 'Selamat sore', meaning: 'Good afternoon', say: 'seh-LAH-mat SOR-eh', group: 'Greetings' },
      { phrase: 'Apa kabar?', meaning: 'How are you?', say: 'AH-pah KAH-bar', group: 'Greetings' },
      { phrase: 'Terima kasih', meaning: 'Thank you', say: 'teh-REE-mah KAH-see', group: 'Courtesy' },
      { phrase: 'Sama-sama', meaning: 'You are welcome', say: 'SAH-mah SAH-mah', group: 'Courtesy' },
      { phrase: 'Permisi', meaning: 'Excuse me', say: 'per-MEE-see', group: 'Courtesy' },
      { phrase: 'Tampi asih', meaning: 'Thank you (Sasak)', say: 'TAM-pee AH-see', group: 'Courtesy' },
      { phrase: 'Berapa harganya?', meaning: 'How much is it?', say: 'beh-RAH-pah har-GAH-nyah', group: 'Getting by' },
      { phrase: 'Tidak, terima kasih', meaning: 'No, thank you', say: 'TEE-dak teh-REE-mah KAH-see', group: 'Getting by' },
      { phrase: 'Enak sekali', meaning: 'Delicious', say: 'eh-NAK seh-KAH-lee', group: 'Eating' },
      { phrase: 'Tidak pedas', meaning: 'Not spicy', say: 'TEE-dak peh-DAS', group: 'Eating' },
      { phrase: 'Tolong!', meaning: 'Help!', say: 'TOH-long', group: 'Help' },
      { phrase: 'Di mana kamar kecil?', meaning: 'Where is the toilet?', say: 'dee MAH-nah KAH-mar keh-CHEEL', group: 'Help' },
    ],
    responsible: [
      'Stay in Sasak-owned losmen and homestays rather than the new foreign-built villa compounds',
      'Water is scarce in the south and the hotels compete with the farms for it — short showers, and refuse the daily towel change',
      'Hire local guides for Rinjani through the village cooperatives; the porter wage is the whole argument',
      'Carry your rubbish off the mountain and off the beaches — the island’s waste collection does not reach most of the coast',
      'Buy songket and basketry from the weaving villages themselves, not the roadside resellers',
    ],
    customs: [
      'Friday midday prayers empty shops and offices for an hour or two',
      'Alcohol is not widely sold outside tourist areas and drinking in public is not done',
      'Tipping is not expected but is kept; round up, or 5–10% for a guide who worked hard',
      'Public affection between couples is uncomfortable for most people here, including hand-holding in villages',
      'Bargaining is normal at markets and for transport, and it is meant to be good-humoured',
    ],
    advisories: [
      'Rinjani is an active volcano and the park closes — for eruption risk, for the rainy season, for rescues. The park authority’s own status is the thing to check on the day, not a line written here',
      'The south coast is open ocean with real rips, and lifeguards are rare outside the main bays. The local guide carries dated readings; a guide who knows the bank is worth more than any of it',
      'Mosquito-borne illness including dengue is present year-round and worse in the rains. Repellent, and a mosquito net if your room has one',
      'Agree a fare before getting into any car or onto any bike, and ride helmeted — scooter injuries are what most visitors actually come to grief on',
      'Drink bottled or filtered water, and be careful with ice outside established places',
    ],
    seasons: [
      { months: 'Apr – Jun', label: 'Best all round', text: 'Dry, green from the rains, warm water and smaller crowds than July. The pick of the year if you can choose.' },
      { months: 'Jul – Sep', label: 'Dry & busy', text: 'Peak season. Reliable south-coast swell, strong trade winds, every bed booked and prices up.' },
      { months: 'Oct – Mar', label: 'Wet', text: 'Heavy afternoon rain, humid, cheapest. Rinjani usually closes January to March, and the lush months are the prettiest.' },
    ],
    community: [
      'Freediving with Gili Air instructors who train local kids alongside visitors',
      'Staying in a Sasak village homestay in Sade or Ende rather than visiting one for an hour',
      'Rinjani trekking booked through the Senaru porter cooperative',
      'Pottery at Banyumulek and weaving at Sukarara, bought from the makers',
    ],
    faq: [
      { q: 'How is it different from Bali?', a: 'Quieter, poorer, predominantly Muslim rather than Hindu, and with far less infrastructure. There is no Canggu here. That is most of the appeal and also the thing people are underprepared for — distances take longer than the map suggests and the roads are not good.' },
      { q: 'What should I wear?', a: 'Light, loose and covering shoulders and knees once you leave the beach. Women are not required to cover their hair except inside a mosque, where a scarf is offered. Men in shorts are fine in tourist areas, less so in a village.' },
      { q: 'Is it alright to visit during Ramadan?', a: 'Yes, and it is a remarkable time to be here. The courtesy is not eating, drinking or smoking in public during daylight, and dressing more conservatively than usual. Hotels serve food as normal. Breaking the fast at sunset is a generous, sociable thing you will probably be invited into.' },
      { q: 'Can I climb Rinjani?', a: 'In season and with a licensed guide, which is a legal requirement and not a formality. It is a serious two or three day trek at altitude on volcanic scree, not a hike. The park’s own closure notices are what decides it, and they change.' },
      { q: 'Is the surf for beginners?', a: 'Some of it. Gerupuk has gentler banks and schools; Desert Point and much of the south-west do not, and are not a place to learn. We will not tell you a break is safe — the gate in this product refuses demanding departures to anyone who has not stated an ability for exactly this reason.' },
      { q: 'How do I get around?', a: 'Scooter if you are genuinely experienced, with a helmet and an international licence — your travel insurance will ask. Otherwise a driver for the day is cheap and spares you the roads.' },
      { q: 'Do people speak English?', a: 'In the Gilis and the south-coast hotels, yes. In villages, Sasak first and Indonesian second. A few words of Indonesian goes a long way; a few words of Sasak goes further.' },
    ],
  },
  {
    destination: 'bali',
    reviewedAt: '2026-10-29',
    intro:
      'Bali is a Hindu island in the world’s largest Muslim country, and the religion is not background — it is the calendar, the architecture and the reason there are offerings on the pavement every morning. Ubud, Sidemen and Uluwatu are three different places, and the gap between the Bali people picture and the Bali that exists is mostly a question of which one you book.',
    etiquette: [
      { title: 'Step around the canang sari', text: 'The small palm-leaf offerings on pavements and doorsteps are placed fresh each morning. Walk around them. Treading on one is not a small thing.' },
      { title: 'Cover up at temples', text: 'A sarong and sash, worn by everyone including men, and usually lent at the entrance. Shoulders covered. Do not climb on shrines for a photograph.' },
      { title: 'Never touch a head', text: 'Including a child’s. The head is the most sacred part of the body, and the feet the least — do not point your feet at a person or a shrine.' },
      { title: 'Menstruating women do not enter temples', text: 'It is posted at every entrance. It is not negotiable and it is not aimed at visitors in particular.' },
    ],
    traditions: [
      { title: 'Nyepi', text: 'The day of silence, in March. The entire island stops: no flights, no traffic, no lights, no leaving your accommodation, for 24 hours. The night before is the ogoh-ogoh parade and it is extraordinary.' },
      { title: 'Galungan and Kuningan', text: 'Ten days when ancestral spirits return. Penjor — tall decorated bamboo poles — line every street. It moves through the 210-day Pawukon calendar, so it is not on a fixed date.' },
      { title: 'Melukat', text: 'Water purification at a holy spring, Tirta Empul being the best known. Visitors may take part, with a guide, properly dressed and with the ritual explained rather than performed for a camera.' },
      { title: 'Odalan', text: 'Every temple has its own anniversary festival. If you arrive during one, you are generally welcome to watch from the edge in a sarong.' },
    ],
    language: [
      { phrase: 'Om swastiastu', meaning: 'Hindu greeting (Balinese)', say: 'ohm swas-tee-AS-too', group: 'Greetings' },
      { phrase: 'Selamat pagi', meaning: 'Good morning (Indonesian)', say: 'seh-LAH-mat PAH-gee', group: 'Greetings' },
      { phrase: 'Apa kabar?', meaning: 'How are you?', say: 'AH-pah KAH-bar', group: 'Greetings' },
      { phrase: 'Suksma', meaning: 'Thank you (Balinese)', say: 'SOOK-smah', group: 'Courtesy' },
      { phrase: 'Terima kasih', meaning: 'Thank you (Indonesian)', say: 'teh-REE-mah KAH-see', group: 'Courtesy' },
      { phrase: 'Permisi', meaning: 'Excuse me', say: 'per-MEE-see', group: 'Courtesy' },
      { phrase: 'Berapa?', meaning: 'How much?', say: 'beh-RAH-pah', group: 'Getting by' },
      { phrase: 'Tidak apa-apa', meaning: 'It is fine / no problem', say: 'TEE-dak AH-pah AH-pah', group: 'Getting by' },
      { phrase: 'Saya tidak mau, terima kasih', meaning: 'I do not want it, thank you', say: 'SAH-yah TEE-dak MAH-oo', group: 'Getting by' },
      { phrase: 'Enak', meaning: 'Tasty', say: 'eh-NAK', group: 'Eating' },
      { phrase: 'Tanpa daging', meaning: 'Without meat', say: 'TAN-pah DAH-ging', group: 'Eating' },
      { phrase: 'Tolong!', meaning: 'Help!', say: 'TOH-long', group: 'Help' },
      { phrase: 'Panggil dokter', meaning: 'Call a doctor', say: 'PANG-gil DOK-ter', group: 'Help' },
    ],
    responsible: [
      'Stay in Balinese-owned guesthouses; the villa boom has taken rice terraces out of production across the south',
      'Water is the island’s real crisis — the aquifer is over-drawn and the hotels are the heaviest users. Skip the private pool if you can',
      'Refuse single-use plastic; Bali banned plastic bags in 2019 and refill stations are everywhere',
      'Do not take photographs at a cremation or a ceremony without being invited to',
      'Pay for the guide, the driver and the workshop directly rather than through a booking layer where you can',
    ],
    customs: [
      'Shoes off at the door of a home and many shops',
      'Pass and receive with the right hand, or both',
      'Tipping is not traditional but is now normal in tourism — 5–10%, and in cash to the person',
      'Bargaining at markets, never in shops with marked prices, and always lightly',
      'Many businesses close for ceremony days with little notice. It is not disorganisation',
    ],
    advisories: [
      'The south-coast breaks at Uluwatu, Padang Padang and Bingin are reef, at low tide, with strong currents, and are not a place to learn. The local guide carries dated readings and even those are hours old — ask somebody who surfed it that morning',
      'Scooter accidents are overwhelmingly the thing that goes wrong for visitors. Helmet, international licence, and check your insurance actually covers you',
      'Rabies is present on the island. Do not approach dogs or the Ubud monkeys, and treat any bite or scratch as a same-day medical matter',
      'Dengue is year-round, worse in the rains. Repellent morning and evening',
      'Drink bottled or filtered water. Reputable restaurants use safe ice; roadside carts may not',
    ],
    seasons: [
      { months: 'Apr – Jun', label: 'The sweet spot', text: 'Dry, green, warm, and before the European holidays arrive. Best value and best weather at once.' },
      { months: 'Jul – Aug', label: 'Peak', text: 'Dry and busy everywhere, with prices and traffic to match. Reliable dry-season swell on the west coast.' },
      { months: 'Oct – Mar', label: 'Wet', text: 'Humid, with heavy afternoon rain and the east-coast breaks working. Cheapest, greenest, and January is the wettest month.' },
    ],
    community: [
      'Songket weaving in Sidemen with the women’s cooperative',
      'Staying in a family compound in Sidemen or Munduk instead of a villa',
      'Subak rice-terrace walks guided by the farmers who manage the water system',
      'Cooking classes that start at the market with the person who shops there',
    ],
    faq: [
      { q: 'Is Bali ruined?', a: 'The south — Kuta, Seminyak, Canggu — is heavily developed and the traffic is genuinely bad. Sidemen, Munduk, the north coast and most of the east are not. The island is small on a map and slow in practice, so the answer mostly depends on where you base yourself rather than how long you stay.' },
      { q: 'What do I wear to a temple?', a: 'A sarong and sash over whatever you are wearing, shoulders covered. They are lent or rented at every major temple, so you do not need to buy one. Bare legs, vests and swimwear are refused at the gate.' },
      { q: 'What happens on Nyepi?', a: 'Everything stops for 24 hours, including the airport. You stay inside your accommodation, lights low, and most hotels run a skeleton service. Visitors are expected to observe it. If your dates cross it, plan to be somewhere you are happy to sit still.' },
      { q: 'Can I learn to surf here?', a: 'On the beach breaks — Kuta, Seminyak, Canggu at the right tide — with a school, yes. On the reef at Uluwatu, no, and nobody reputable will take you. This product’s conditions gate refuses demanding departures to anyone who has not stated an ability, which is the same judgement in software.' },
      { q: 'How much should I tip?', a: 'It is not a traditional obligation and it is now widely expected in tourism. 5–10% at restaurants if service is not added, something for a driver or guide at the end of a day, and in cash to the person rather than a card line.' },
      { q: 'Is the tap water drinkable?', a: 'No. Use filtered or bottled, and refill rather than buying new — most guesthouses have a station and the island has a serious plastic problem.' },
      { q: 'Do I need a visa?', a: 'Rules for visa on arrival and e-visas change, and we are not the people to rely on for it. Check your own government’s travel page and the Indonesian immigration site close to departure.' },
    ],
  },
  {
    destination: 'lisbon',
    reviewedAt: '2026-10-29',
    intro:
      'Lisbon is a capital built on seven hills at the mouth of the Tejo, rebuilt on a grid after the 1755 earthquake, and currently living through the sharpest tourism boom in its history. The light and the tiles are as advertised. The hills are steeper than they look, the city is in a housing crisis, and both are worth knowing before you arrive.',
    etiquette: [
      { title: 'Greet before you ask', text: '“Bom dia” or “boa tarde” before the question, in every shop and café. Opening with English and no greeting is the common visitor mistake.' },
      { title: 'Do not confuse it with Spain', text: 'Portuguese is not a dialect of Spanish, “olé” belongs to another country, and speaking Spanish at people here lands badly. English is better received than Spanish.' },
      { title: 'Keep fado quiet', text: 'In a fado house you stop talking when the singing starts. No photographs, no phone screens. It is a performance with rules and the audience is part of them.' },
      { title: 'Queue and wait your turn', text: 'Many counters, bakeries and public offices use a ticket machine. Take one; nobody will tell you to.' },
    ],
    traditions: [
      { title: 'Santo António', text: '12–13 June. The whole city grills sardines in the street, Alfama and Graça fill with bunting and bad wine, and couples marry in the Casamentos de Santo António. The loudest, best night of the year.' },
      { title: 'Fado', text: 'A UNESCO-listed song form from the working-class quarters, about longing and loss. The honest houses are small and in Alfama or Mouraria; the ones with a set menu and a coach outside are not.' },
      { title: 'Café culture', text: 'A bica at the counter, standing, costs a fraction of the same coffee at a table. Both are correct; the counter is the local one.' },
      { title: 'Azulejos', text: 'The tiles are structural history, not decoration. They are also stolen from façades and sold — buy from a workshop, never from a market stall selling single old tiles.' },
    ],
    language: [
      { phrase: 'Bom dia', meaning: 'Good morning', say: 'bohn DEE-ah', group: 'Greetings' },
      { phrase: 'Boa tarde', meaning: 'Good afternoon', say: 'BOH-ah TAR-deh', group: 'Greetings' },
      { phrase: 'Boa noite', meaning: 'Good evening / night', say: 'BOH-ah NOY-teh', group: 'Greetings' },
      { phrase: 'Obrigado / Obrigada', meaning: 'Thank you (said by a man / a woman)', say: 'oh-bree-GAH-doo / -dah', group: 'Courtesy' },
      { phrase: 'Se faz favor', meaning: 'Please / excuse me', say: 'seh fash fah-VOR', group: 'Courtesy' },
      { phrase: 'Com licença', meaning: 'Excuse me (passing)', say: 'kohn lee-SEN-sah', group: 'Courtesy' },
      { phrase: 'Desculpe', meaning: 'Sorry', say: 'desh-KOOL-peh', group: 'Courtesy' },
      { phrase: 'Fala inglês?', meaning: 'Do you speak English?', say: 'FAH-lah een-GLESH', group: 'Getting by' },
      { phrase: 'Quanto custa?', meaning: 'How much is it?', say: 'KWAN-too KOOSH-tah', group: 'Getting by' },
      { phrase: 'Uma bica, se faz favor', meaning: 'An espresso, please', say: 'OO-mah BEE-kah', group: 'Eating' },
      { phrase: 'A conta, se faz favor', meaning: 'The bill, please', say: 'ah KOHN-tah', group: 'Eating' },
      { phrase: 'Não, obrigado', meaning: 'No, thank you (to the couvert)', say: 'nowng oh-bree-GAH-doo', group: 'Eating' },
      { phrase: 'Preciso de ajuda', meaning: 'I need help', say: 'preh-SEE-zoo deh ah-ZHOO-dah', group: 'Help' },
    ],
    responsible: [
      'Short-term lets are the centre of a real housing crisis here. A licensed guesthouse or a hotel is a different thing from an apartment taken off the residential market',
      'Eat in tascas away from Baixa and Belém — the family restaurants are what the centre is losing',
      'Buy tiles, cork and ceramics from workshops, not from stalls selling tiles prised off buildings',
      'Use the metro and the funiculars rather than Uber; the 28 tram is a commuter service that visitors have made unusable for residents',
      'Tip the fado house directly if you can — the singers are frequently on a cut of nothing',
    ],
    customs: [
      'Lunch is 13:00–15:00, dinner rarely before 20:00 and usually later',
      'The couvert — bread, olives, cheese put on your table unasked — is charged. Refusing it is normal and not rude',
      'Tipping is light: round up, or 5–10% for a good meal. Service is not usually added',
      'Many museums close on Mondays; most small shops close Sunday',
      'August empties the city of Lisboetas, who go to the coast',
    ],
    advisories: [
      'The hills and the calçada — polished limestone cobbles — are slick in rain and genuinely hard on knees and wheels. Shoes with grip matter more here than in most cities',
      'Pickpocketing is concentrated on tram 28, the metro at rush hour and the Alfama viewpoints. It is opportunistic rather than confrontational',
      'People will offer you drugs on Rua Augusta. It is a long-running scam and the product is fake; the answer is to keep walking',
      'The Atlantic beaches west of the city have strong rips and the flag system is posted and meant. The lifeguard, not a guidebook, is the authority on the day',
      'Tap water is drinkable here and tastes slightly of chlorine. Nobody needs to buy bottles',
    ],
    seasons: [
      { months: 'Mar – May', label: 'The best of it', text: 'Mild, bright, jacaranda in late May, and before the crowds. The pick of the year.' },
      { months: 'Jun – Aug', label: 'Hot & full', text: 'Over 30°C, every queue long, and Santo António in June. Many buildings have no air conditioning.' },
      { months: 'Sep – Nov', label: 'Warm then wet', text: 'September is often better than June. From late October the Atlantic rain arrives and the cobbles get slippery.' },
    ],
    community: [
      'Fado in a small Alfama or Mouraria house rather than a dinner-show',
      'Petiscos walks led by residents through Campo de Ourique and Marvila',
      'Tile workshops where you glaze your own rather than buy a salvaged one',
      'Buying at the Feira da Ladra from the traders, early, before the resellers',
    ],
    faq: [
      { q: 'Do I need Portuguese?', a: 'No — English is widely spoken, more so than in most European capitals. A greeting in Portuguese before you switch is the whole courtesy, and it is noticed every time.' },
      { q: 'What is the couvert?', a: 'The bread, olives, butter or cheese that arrives before you ordered anything. It is not free and it is not a scam; it is a charge you can decline. “Não, obrigado” as it lands is completely normal.' },
      { q: 'How much do I tip?', a: 'Less than you are used to if you are American. Rounding up is fine; 5–10% is generous. Service is rarely added and nobody chases you.' },
      { q: 'Is tram 28 worth it?', a: 'The route is beautiful and the queue is long, and it is also a working bus for people who live on that hill. Ride it early morning, or take tram 12 or walk the same streets and leave the seat.' },
      { q: 'Can I swim near Lisbon?', a: 'Carcavelos, Guincho and the Costa da Caparica are all a short train or bus away. The Atlantic here is cold, properly cold, and the beaches west of Cascais have serious rips. The flags and the lifeguards are the authority — we will not tell you a beach is safe.' },
      { q: 'Is it expensive?', a: 'Cheaper than northern Europe and no longer cheap. A pastel de nata and a bica is still under three euros; a restaurant in Chiado is European-capital priced. The gap between tourist and neighbourhood prices is wide, and worth crossing.' },
      { q: 'What about the housing thing?', a: 'Rents in the centre have roughly doubled in a decade and the city has lost a large share of its resident population. It is the live political argument here. Staying in a licensed hotel or guesthouse rather than an apartment is the one choice a visitor actually controls.' },
    ],
  },
  {
    destination: 'ericeira',
    reviewedAt: '2026-10-29',
    intro:
      'Ericeira is a fishing town of about seven thousand people, forty minutes north of Lisbon, that happens to hold Europe’s only World Surfing Reserve — eight breaks along four kilometres of reef. It is a working town first and a surf town second, and the two have an uneasy relationship that a visitor is better off understanding than ignoring.',
    etiquette: [
      { title: 'Greet in Portuguese', text: '“Bom dia” before anything else, in the bakery, the fish market and the surf shop. The town is small enough that manners are remembered.' },
      { title: 'Respect the line-up', text: 'Ribeira d’Ilhas, Coxos and Pedra Branca have locals who have surfed them for thirty years. Coxos in particular is not a visitor’s wave. Wait, do not drop in, and leave if you are out of your depth.' },
      { title: 'Do not park on the cliff', text: 'Vans overnighting on the headlands is the single thing that has most soured the town on surf tourism. There are campsites. Use them.' },
      { title: 'Cover up in town', text: 'Wetsuit half-off walking to the car is fine. Shirtless in the supermarket or the café is not, and it reads as treating the place as a beach.' },
    ],
    traditions: [
      { title: 'Festa de Santo António', text: 'Ericeira’s own August festival, with processions down to the harbour, bands and fireworks over the water. The town’s calendar peak, not the surf season’s.' },
      { title: 'The fishing fleet', text: 'Small boats still work out of the harbour at Ribeira. The lobster and the percebes on the restaurant menus came off them that morning, which is why they cost what they do.' },
      { title: 'The World Surfing Reserve', text: 'Dedicated in 2011, the first in Europe. It is a protection designation won by local campaigners against coastal development, not a marketing line.' },
      { title: 'Sunday lunch', text: 'Long, family-sized, and the thing the whole town does. Restaurants fill from one o’clock and do not hurry.' },
    ],
    language: [
      { phrase: 'Bom dia', meaning: 'Good morning', say: 'bohn DEE-ah', group: 'Greetings' },
      { phrase: 'Boa tarde', meaning: 'Good afternoon', say: 'BOH-ah TAR-deh', group: 'Greetings' },
      { phrase: 'Tudo bem?', meaning: 'All good? (casual)', say: 'TOO-doo BENG', group: 'Greetings' },
      { phrase: 'Obrigado / Obrigada', meaning: 'Thank you (man / woman speaking)', say: 'oh-bree-GAH-doo / -dah', group: 'Courtesy' },
      { phrase: 'Se faz favor', meaning: 'Please', say: 'seh fash fah-VOR', group: 'Courtesy' },
      { phrase: 'Desculpe', meaning: 'Sorry / excuse me', say: 'desh-KOOL-peh', group: 'Courtesy' },
      { phrase: 'Como está o mar?', meaning: 'How is the sea?', say: 'KOH-moo esh-TAH oo mar', group: 'Getting by' },
      { phrase: 'Está a subir?', meaning: 'Is it picking up?', say: 'esh-TAH ah soo-BEER', group: 'Getting by' },
      { phrase: 'Onde posso alugar uma prancha?', meaning: 'Where can I rent a board?', say: 'OHN-deh POH-soo ah-loo-GAR', group: 'Getting by' },
      { phrase: 'A conta, se faz favor', meaning: 'The bill, please', say: 'ah KOHN-tah', group: 'Eating' },
      { phrase: 'O prato do dia', meaning: 'The dish of the day', say: 'oo PRAH-too doo DEE-ah', group: 'Eating' },
      { phrase: 'Socorro!', meaning: 'Help!', say: 'soo-KOH-roo', group: 'Help' },
      { phrase: 'Chame o nadador-salvador', meaning: 'Call the lifeguard', say: 'SHAH-meh oo nah-dah-DOR', group: 'Help' },
    ],
    responsible: [
      'Sleep in a guesthouse or a campsite, not a van on the cliff — the overnight parking ban exists because of visitors',
      'Eat the fish the fleet landed rather than the imported menu; it is cheaper and it is the point of the town',
      'The reef is protected. Do not stand on it, and carry your wax and leash scraps off the rocks',
      'Book lessons with Ericeira schools rather than Lisbon operators who bus people in for the morning',
      'Out of season is when the town needs the money. October and March are better for everybody than August',
    ],
    customs: [
      'Lunch 13:00–15:00, dinner from 20:00. Kitchens close earlier than in Lisbon',
      'The couvert on the table is charged and can be refused',
      'Tipping is rounding up, or 5–10% for a long meal. Nothing more is expected',
      'Shops often close 13:00–15:00, and much of the town closes Sunday afternoon',
      'Cash is still welcome in the market and the smaller tascas',
    ],
    advisories: [
      'This is cold, exposed North Atlantic over reef. The breaks here range from a beginner beach at Foz do Lizandro to Coxos, which is a serious wave, and the difference is not obvious from the cliff. The dated readings on the local guide are a starting point and a school or a lifeguard is a better one',
      'Water is 14–18°C through the year. A 3/2 in summer, a 4/3 and boots in winter, and hypothermia is the thing that actually catches visitors out',
      'The cliffs erode and sections collapse. The fenced-off paths are fenced for a reason',
      'Rips run hard along the beach breaks on a dropping tide. The flag system is posted at lifeguarded beaches in season and unmanned outside it',
      'Tap water is drinkable, unlike in much of the region',
    ],
    seasons: [
      { months: 'Sep – Nov', label: 'The season', text: 'Consistent autumn swell, water still warm from summer, town quiet again. What people come for.' },
      { months: 'Dec – Mar', label: 'Big & cold', text: 'The heaviest swell of the year and the coldest water. Expert conditions on the reefs; the beach breaks still work on the smaller days.' },
      { months: 'Apr – Aug', label: 'Small & busy', text: 'Gentlest surf and the best learning conditions, along with the crowds, the Lisbon weekenders and August prices. Strong afternoon northerlies.' },
    ],
    community: [
      'Lessons with Ericeira-run schools whose instructors grew up on these banks',
      'Buying percebes and lobster at the harbour rather than from a menu in Lisbon',
      'Reef clean-ups run by the World Surfing Reserve stewards',
      'Staying in family guesthouses in Ribamar and the old town out of season',
    ],
    faq: [
      { q: 'Is this a good place to learn?', a: 'At Foz do Lizandro and São Julião, with a school, yes — they are sand-bottomed beach breaks with gentle days. The reefs are not, and Coxos is a wave for people who already know they are good enough. This product’s conditions gate will not offer a demanding departure to somebody who has stated no ability, and that is the same judgement.' },
      { q: 'How cold is the water, really?', a: 'Fourteen to eighteen degrees depending on the month, which is colder than most people expect of Portugal. A 3/2 wetsuit for summer, 4/3 with boots and often a hood in winter. Rental shops have everything.' },
      { q: 'Can I sleep in my van?', a: 'Not on the cliffs or the beach car parks — it is banned and enforced, and it is the local grievance about surf tourism. There are campsites in and around the town that cost very little.' },
      { q: 'Do I need a car?', a: 'The town is walkable and the nearest breaks are not. A car or a bike makes the difference between surfing one spot and surfing eight. Buses from Lisbon run to the town but not along the coast.' },
      { q: 'When should I come?', a: 'September and October: swell, warm-ish water, and the town back to itself. August has the smallest waves, the most people and the highest prices.' },
      { q: 'Do people speak English?', a: 'In the surf schools and most restaurants, yes. In the market and the older tascas, less. The greeting in Portuguese does more work here than it does in Lisbon.' },
      { q: 'How far is Lisbon?', a: 'About 50 km, forty-five minutes by car, an hour or so by bus from Campo Grande. Easy as a day trip in either direction, which is also why the weekends are busy.' },
    ],
  },
  {
    destination: 'chamonix',
    reviewedAt: '2026-10-29',
    intro:
      'Chamonix sits in a narrow valley under the north face of Mont Blanc, and it is the birthplace of alpinism — the first ascent went from here in 1786 and the first Winter Olympics were held here in 1924. It is a serious mountain town rather than a resort: the lifts put anybody within twenty minutes of genuinely dangerous terrain, and the guides’ bureau has existed since 1821 for that reason.',
    etiquette: [
      { title: 'Say bonjour on entering', text: 'Every shop, every bakery, every lift queue, and “au revoir” on the way out. In France this is not optional politeness, it is the opening of the transaction.' },
      { title: 'Use vous', text: 'Address anyone you do not know as “vous”. Mountain guides and lift staff included, until invited otherwise.' },
      { title: 'Respect the mountain rescue', text: 'The PGHM are not a tourist service. Going unprepared into terrain that needs them, so somebody flies in weather they would rather not, is the thing the valley has least patience for.' },
      { title: 'Lunch is not a quick thing', text: 'Restaurants serve roughly 12:00–14:00 and then stop. Turning up at 14:30 expecting food misunderstands the day.' },
    ],
    traditions: [
      { title: 'La Fête des Guides', text: '15 August. The Compagnie des Guides parades through town, new guides are received, and the valley honours the ones it has lost. Older than any ski season.' },
      { title: 'The UTMB', text: 'Late August. The Ultra-Trail du Mont-Blanc takes over the valley for a week and the town does not sleep. Book a year out or avoid the dates entirely.' },
      { title: 'Savoyard table', text: 'Fondue, raclette, tartiflette and diots — peasant food built for cold work. Eaten slowly, with white wine, and genuinely not a summer dish.' },
      { title: 'The Compagnie des Guides', text: 'Founded 1821 and still the institution the valley runs on. Hiring a guide here is a two-hundred-year-old arrangement, not a tourist add-on.' },
    ],
    language: [
      { phrase: 'Bonjour', meaning: 'Hello / good day', say: 'bohn-ZHOOR', group: 'Greetings' },
      { phrase: 'Bonsoir', meaning: 'Good evening', say: 'bohn-SWAR', group: 'Greetings' },
      { phrase: 'Au revoir', meaning: 'Goodbye', say: 'oh ruh-VWAR', group: 'Greetings' },
      { phrase: 'S’il vous plaît', meaning: 'Please', say: 'seel voo PLEH', group: 'Courtesy' },
      { phrase: 'Merci beaucoup', meaning: 'Thank you very much', say: 'mehr-SEE boh-KOO', group: 'Courtesy' },
      { phrase: 'Pardon / Excusez-moi', meaning: 'Sorry / excuse me', say: 'par-DOHN / ex-kew-zay-MWAH', group: 'Courtesy' },
      { phrase: 'Parlez-vous anglais?', meaning: 'Do you speak English?', say: 'par-lay VOO ahn-GLEH', group: 'Getting by' },
      { phrase: 'Quelles sont les conditions?', meaning: 'What are the conditions?', say: 'kel sohn lay kon-dee-SYOHN', group: 'Getting by' },
      { phrase: 'Le téléphérique est ouvert?', meaning: 'Is the cable car running?', say: 'luh tay-lay-fay-REEK eh oo-VEHR', group: 'Getting by' },
      { phrase: 'L’addition, s’il vous plaît', meaning: 'The bill, please', say: 'lah-dee-SYOHN', group: 'Eating' },
      { phrase: 'Une carafe d’eau', meaning: 'A jug of tap water (free)', say: 'ewn kah-RAHF doh', group: 'Eating' },
      { phrase: 'Au secours!', meaning: 'Help!', say: 'oh suh-KOOR', group: 'Help' },
      { phrase: 'Appelez le PGHM', meaning: 'Call mountain rescue', say: 'ah-play luh pay-zhay-ahsh-EM', group: 'Help' },
    ],
    responsible: [
      'Take the train from Geneva or Saint-Gervais rather than driving; the valley’s air sits in it and the winter inversions are bad',
      'Hire guides through the Compagnie or local bureaus — the money stays in the valley and the standard is enforced',
      'Stay on marked paths above the treeline; the alpine meadows take decades to recover from short-cutting',
      'The glaciers are retreating fast enough to see between visits. The ladders down to the Mer de Glace are a measurement, not a feature',
      'Refill from the fountains. The valley water is excellent and the bottled kind is absurd here',
    ],
    customs: [
      'Lunch 12:00–14:00 and dinner from 19:30; kitchens genuinely close in between',
      'Service is included by law — tipping is rounding up or a couple of euros, not a percentage',
      'A carafe d’eau is free and asking for one is completely normal',
      'Shops may close 12:00–14:00, and Sunday outside the high seasons',
      'The valley speaks French first; English is everywhere in the mountain trades but is not assumed in the bakery',
    ],
    advisories: [
      'The lifts put you at 3,800 m in twenty minutes from 1,000 m. Altitude sickness at the Aiguille du Midi is common and the answer is to go back down, not to push through',
      'Glacier terrain, including the Vallée Blanche, is crevassed and not a marked run. It needs a guide and the equipment to go with one. ARC does not certify any route in the mountains, and nobody should',
      'Avalanche risk is published daily on a five-point scale by Météo-France. That bulletin, on the day, is the thing to read — not any line written here months earlier',
      'Mountain weather turns in under an hour. Carry layers, water and a charged phone even for a short marked walk, and tell somebody your route',
      'Mountain rescue in France is charged for. Check your insurance explicitly covers helicopter rescue and off-piste or glacier activity; most standard travel policies do not',
    ],
    seasons: [
      { months: 'Dec – Apr', label: 'Winter', text: 'Skiing and ski touring, short cold days, and the valley full. January and February are the coldest and most reliable for snow.' },
      { months: 'May – Jun', label: 'Between seasons', text: 'Lifts largely shut, paths still under snow, waterfalls at their fullest. Quiet and cheap, and much of the high terrain is simply closed.' },
      { months: 'Jul – Sep', label: 'Summer', text: 'Hiking, alpinism and climbing, long days and the Tour du Mont Blanc in full flow. Late August is UTMB week and the valley is full.' },
    ],
    community: [
      'Hiring through the Compagnie des Guides rather than an online broker',
      'Mountain refuges run by wardens who live up there for the season',
      'Buying Beaufort, Reblochon and charcuterie at the Saturday market in town',
      'Glacier-retreat walks led by the valley’s own guides, who have watched it happen',
    ],
    faq: [
      { q: 'Do I need a guide?', a: 'For marked summer paths and pisted skiing, no. For anything on a glacier — the Vallée Blanche included — for any alpinism, and for off-piste, yes, and it is not a formality. The terrain here is reachable by cable car and lethal, which is an unusual combination and the reason the guides’ bureau is two hundred years old.' },
      { q: 'Will I feel the altitude?', a: 'Very likely at the Aiguille du Midi, which is 3,842 m and twenty minutes from the town at 1,035 m. Breathlessness, headache and nausea are common. Move slowly, do not go straight up on your first morning, and come down if it gets worse rather than waiting it out.' },
      { q: 'Is my travel insurance enough?', a: 'Probably not. French mountain rescue is charged to the person rescued, and most standard policies exclude glacier travel, off-piste and alpinism. Read the exclusions before you book anything, and the Carte Neige or a guide’s own cover is often the simpler route.' },
      { q: 'Can I visit without skiing or climbing?', a: 'Easily. The Montenvers train, the Brévent and Flégère lifts, the Mer de Glace, the valley path and the Saturday market fill several days, and the summer hiking is some of the best in Europe on marked, maintained paths.' },
      { q: 'Do I need French?', a: 'Not in the mountain trades, where English is universal. In the bakery, the bus and the smaller restaurants, bonjour and merci do a great deal of work and their absence is noticed.' },
      { q: 'What does it cost?', a: 'It is an expensive valley. Lift passes, guides and restaurants are all at the top end of the Alps. The refuges, the market and a carafe of tap water are how people here actually manage it.' },
      { q: 'When are the lifts open?', a: 'Roughly December to April and mid-June to late September, with a gap in May and November when most of the system shuts for maintenance. The operator publishes the dates each year and they move — check before booking around them.' },
    ],
  },
  {
    destination: 'cape-town',
    reviewedAt: '2026-10-29',
    intro:
      'Cape Town sits between Table Mountain and two oceans, inside a floral kingdom found nowhere else on earth, and it is also one of the most unequal cities in the world — a fact built into its geography by apartheid’s forced removals and still visible from any road out of the airport. Travelling well here means holding both of those at once.',
    etiquette: [
      { title: 'Greet properly and unhurriedly', text: '“Howzit” or a “good morning, how are you?” before the request. Launching straight into what you want is read as rude across all the city’s cultures.' },
      { title: 'Learn which language you are in', text: 'isiXhosa, Afrikaans and English are all Cape Town languages. “Molo” and “enkosi” in isiXhosa, or “dankie” in Afrikaans, are small things that land well.' },
      { title: 'Township tours: choose carefully', text: 'Go with an operator based in Langa, Khayelitsha or Gugulethu, run by residents, that stays for a meal and pays the people in it. Photographing homes from a minibus window is the thing to refuse.' },
      { title: 'Be careful with race and history', text: 'Apartheid ended in 1994 and the people you meet lived through it. Listen more than you offer, and do not treat the District Six Museum or Robben Island as a photo stop.' },
    ],
    traditions: [
      { title: 'Tweede Nuwe Jaar', text: '2 January. The Cape Minstrel Carnival fills the streets with satin, banjos and brass — a tradition that began with the one day a year enslaved people were given off.' },
      { title: 'The braai', text: 'Not a barbecue. A social institution with its own etiquette, its own public holiday in September, and a fire built from wood rather than gas.' },
      { title: 'Cape Malay cooking', text: 'Bobotie, koesisters and bredie, from the Bo-Kaap, carrying four centuries of forced migration from Southeast Asia in the spicing.' },
      { title: 'Heritage Day', text: '24 September. Officially a celebration of the country’s cultures, colloquially National Braai Day, and in practice both.' },
    ],
    language: [
      { phrase: 'Molo / Molweni', meaning: 'Hello (to one / to many, isiXhosa)', say: 'MOH-loh / mol-WEH-nee', group: 'Greetings' },
      { phrase: 'Goeie môre', meaning: 'Good morning (Afrikaans)', say: 'KHOO-yuh MOR-uh', group: 'Greetings' },
      { phrase: 'Howzit', meaning: 'Hi / how are you (everywhere)', say: 'HOW-zit', group: 'Greetings' },
      { phrase: 'Unjani?', meaning: 'How are you? (isiXhosa)', say: 'oon-JAH-nee', group: 'Greetings' },
      { phrase: 'Enkosi', meaning: 'Thank you (isiXhosa)', say: 'en-KOH-see', group: 'Courtesy' },
      { phrase: 'Dankie', meaning: 'Thank you (Afrikaans)', say: 'DUN-kee', group: 'Courtesy' },
      { phrase: 'Asseblief', meaning: 'Please (Afrikaans)', say: 'AH-suh-bleef', group: 'Courtesy' },
      { phrase: 'Ncede', meaning: 'Please (isiXhosa)', say: 'n-TSEH-deh', group: 'Courtesy' },
      { phrase: 'Just now / now now', meaning: 'Later, sometime / very soon — in that order', say: '—', group: 'Getting by' },
      { phrase: 'Is it?', meaning: 'Really? (a listening noise, not a question)', say: 'izit', group: 'Getting by' },
      { phrase: 'Lekker', meaning: 'Good, tasty, enjoyable', say: 'LEK-uh', group: 'Eating' },
      { phrase: 'Can I get the bill, please?', meaning: 'Asking to pay', say: '—', group: 'Eating' },
      { phrase: 'Nceda!', meaning: 'Help! (isiXhosa)', say: 'n-TSEH-dah', group: 'Help' },
    ],
    responsible: [
      'Book township experiences with resident-owned operators; the difference between that and a drive-through is the whole point',
      'Water is the city’s standing crisis — it came within weeks of running dry in 2018. Short showers, and take the signs in your room seriously',
      'Buy fynbos, ceramics and beadwork from the makers and the Saturday markets rather than the V&A tourist shops',
      'Eat SASSI-green seafood; much of what is on Cape menus is over-fished and the list is published',
      'Tip well. Petrol attendants, car guards and waiters are frequently on very little, and it is a real part of the wage here',
    ],
    customs: [
      'Tipping is 10–15% in restaurants, R5–R20 for a car guard or petrol attendant',
      'Petrol stations are full-service; you do not get out of the car',
      'Load-shedding — scheduled power cuts — still happens. Most places have an app for the schedule and a generator or an inverter',
      '“Just now” means later and “now now” means soon. They are not interchangeable',
      'Braais start late afternoon and run long. Bringing something is normal',
    ],
    advisories: [
      'Table Mountain weather changes in minutes and people die on it every year, usually on the Platteklip or India Venster routes in cloud. Go in a group, tell somebody, take a layer and water, and check the cable car status before relying on it coming down',
      'Both oceans here are cold and the Atlantic side is very cold. Rips are strong at Camps Bay and Llandudno, and lifeguards are seasonal. The flags and the lifeguard are the authority, not a line here',
      'Crime is real and is geographically specific. Do not walk at night, keep phones out of sight at intersections, do not hike alone on the mountain, and ask your accommodation about the specific streets around them — they know and we do not',
      'Hire a car for the peninsula if you can; the distances are large and the public transport does not serve visitors well. Keep doors locked and bags out of sight',
      'Tap water in the city is treated and drinkable. Out on the peninsula, ask',
    ],
    seasons: [
      { months: 'Dec – Feb', label: 'Summer & full', text: 'Hot, dry, long days and the famous south-easter wind. Peak season, peak prices, and the beaches at their best.' },
      { months: 'Mar – May', label: 'The best months', text: 'Warm, still, the wind drops and the crowds leave. Harvest in the winelands. Most people’s pick.' },
      { months: 'Jun – Aug', label: 'Winter', text: 'Cold, wet, dramatic seas and whale season on the False Bay side from July. Cheapest, and the mountain is green.' },
    ],
    community: [
      'Cape Malay cooking in a Bo-Kaap home with the family that cooks it',
      'Fynbos foraging and coastal cooking with guides from the peninsula',
      'Langa and Khayelitsha walking tours run by people who live there',
      'Buying beadwork and ceramics direct at the Oranjezicht and Bay Harbour markets',
    ],
    faq: [
      { q: 'Is it safe?', a: 'ARC does not tell anybody a place is safe, and Cape Town is a city where that answer matters. What is true: crime here is concentrated and situational rather than evenly spread, visitors are rarely targeted in the tourist areas by day, and almost every incident involving a visitor follows the same shapes — walking at night, hiking alone, a phone visible at a traffic light. Ask your accommodation about their specific streets, use a car after dark, and do not hike the mountain alone.' },
      { q: 'Should I do a township tour?', a: 'If you choose well, yes — and the choice is the whole question. A resident-owned operator who stays for a meal and pays the people involved is a completely different thing from a bus with the windows up. Ask who owns it and where the money goes before you book.' },
      { q: 'What is load-shedding?', a: 'Scheduled rolling power cuts, by area, published on a schedule and an app. Most hotels and restaurants run inverters or generators now. Keep a power bank and expect the odd dark hour.' },
      { q: 'How much should I tip?', a: '10–15% at restaurants and more if you can. R5 to R20 for the car guard who watched your car and for the petrol attendant. It is not optional in the way it is in Europe — it is part of how people are paid here.' },
      { q: 'Can I swim?', a: 'The Atlantic side — Camps Bay, Clifton, Llandudno — is around 12–15°C and has real rips. False Bay, at Muizenberg and Fish Hoek, is warmer and gentler and is where the learning happens. There are shark spotters on some False Bay beaches whose flags mean exactly what they say. Read them, and ask the lifeguard.' },
      { q: 'Do I need a car?', a: 'For the peninsula, the winelands and Cape Point, effectively yes. In the City Bowl and Sea Point you can walk and use the MyCiTi bus by day. Minibus taxis are the city’s real transport and are not aimed at visitors.' },
      { q: 'When is whale season?', a: 'Roughly July to November on the False Bay and Hermanus side, with southern right whales close in from the shore. August and September are the peak and you do not need a boat.' },
    ],
  },
]

export const getCulture = (slug?: string) => cultureGuides.find((c) => c.destination === slug)
