/**
 * The six people the simulation plays.
 *
 * A brief, not a script. The pressure-test harness next door
 * (`scripts/pressure-test/`) walks each of these through a written journey and
 * asserts a fixed list of expectations; that suite is the acceptance test and
 * it should stay deterministic. This is the other thing: the same six people,
 * improvising, so that the paths through the product are new every cycle and
 * the readout is about what somebody might do rather than what we remembered
 * to write down.
 *
 * Each brief carries three parts, and the third is the one that matters:
 *
 *  - `goal`, which is what the person wants;
 *  - `knows`, the handful of facts they would have (an address to sign in
 *    with, a reference number), because a person who has to guess a password
 *    is testing the sign-in form and nothing else;
 *  - `mustNeverHappen`, the product's promises stated in this person's terms.
 *    These are what the model is asked to watch for, and they are written from
 *    `CLAUDE.md`'s non-negotiables rather than invented.
 */

export interface PersonaBrief {
  readonly id: string
  readonly name: string
  readonly goal: string
  readonly startPath: string
  readonly knows: readonly string[]
  readonly mustNeverHappen: readonly string[]
  /** Demo sign-in is an account switcher, so a persona names an address. */
  readonly signInAs?: string
}

/** Things that are true for everybody, so each brief does not repeat them. */
export const UNIVERSAL_INVARIANTS: readonly string[] = [
  'Nothing anywhere says a beach, a break or a condition is safe. Conditions are reported with a timestamp and a source, and what may be recommended is gated; a page may say an activity is allowed or not allowed today, and may never say it is safe.',
  'Nothing claims a partner is verified by ARC unless the page also shows the standing is current. "Not verified by ARC" and "verification pending" are correct and expected; a bare "Verified by ARC" on a partner the admin queue lists as unverified is not.',
  'A certification a partner claims is rendered as their claim, never as a fact ARC has checked.',
  'No page offers to send a message to a guest on ARC\'s initiative.',
  'A money figure that is earned revenue is never added to, or shown immediately beside, a figure of potential value.',
  'An advisory from a government source is labelled an advisory, and never rendered as law.',
]

export const PERSONAS: readonly PersonaBrief[] = [
  {
    id: 'hotel-owner',
    name: 'Elena, who runs Casa Olas',
    goal: 'See who is arriving, what needs deciding, and what the property earned — then do one thing about it, such as approving something waiting or looking at a partner.',
    startPath: '/owner',
    knows: ['She is signed in as the owner of Casa Olas.'],
    signInAs: 'elena@casaolas.demo',
    mustNeverHappen: [
      'A figure she would read as money the hotel has earned turns out to include potential or forecast value.',
      'An action with consequences outside ARC happens without her approving it by name.',
      'A partner appears as verified when nobody has verified them.',
    ],
  },
  {
    id: 'supplier-partner',
    name: 'Mariana, who runs a surf school',
    goal: 'Look after her own business page: check how her listing reads to a guest, keep her details right, and see what she has earned.',
    startPath: '/partner',
    knows: ['She is signed in as the partner contact for her own business.'],
    signInAs: 'mariana@olasverdes.demo',
    mustNeverHappen: [
      'She can mark her own business verified, or record her own insurance as checked by ARC.',
      'She can publish her own listing. A partner drafts; the hotel publishes.',
      'She can see anything belonging to another business or another hotel.',
    ],
  },
  {
    id: 'hotel-guest',
    name: 'Harriet, staying at the hotel this week',
    goal: 'Plan the days: say what she likes, look at what the hotel suggests, put something in the basket and try to book it.',
    startPath: '/g',
    knows: ['She reached her portal from the link the hotel gave her.'],
    mustNeverHappen: [
      'Something is offered to her that the conditions for that day do not allow.',
      'She is shown another guest\'s booking, name or trip.',
      'A price changes between what she agreed to and what she is charged.',
    ],
  },
  {
    id: 'direct-traveller',
    name: 'Sam, who is not staying at the hotel',
    goal: 'Browse the destination as a stranger would, try the planner, and see how far a direct booking gets.',
    startPath: '/',
    knows: ['Nothing. No account, no booking, no link.'],
    mustNeverHappen: [
      'Availability or a commercial relationship is implied that nobody has entered.',
      'A trip that is not a room booking is presented as one.',
      'A listing shows a photograph of a real place that nobody licensed.',
    ],
  },
  {
    id: 'arc-admin',
    name: 'The ARC platform admin',
    goal: 'Work the verification queue and the health page: see what is waiting, and try to do the things the product should refuse.',
    startPath: '/admin',
    knows: ['Signed in as a platform admin.'],
    signInAs: 'admin@arctravel.demo',
    mustNeverHappen: [
      'A partner can be marked verified with no checks recorded.',
      'A verification decision is recorded without a named reviewer.',
      'Anything other than this page can produce a verified status.',
    ],
  },
  {
    id: 'adversary',
    name: 'Somebody poking at the edges',
    goal: 'Try the things a careless or curious person would: other people\'s identifiers in URLs, a form submitted with values the page did not offer, a second tab racing the first.',
    startPath: '/',
    knows: ['Only what a page or a URL shows them.'],
    mustNeverHappen: [
      'A page belonging to another guest, hotel or partner opens.',
      'A refusal is a blank screen or a stack trace rather than an explanation.',
      'More of something is sold than exists.',
    ],
  },
]

export function personaById(id: string): PersonaBrief | undefined {
  return PERSONAS.find((persona) => persona.id === id)
}
