import type { PersonaBrief } from './personas'

/**
 * A new situation each time, from synthetic ingredients.
 *
 * The point of a live simulation over a fixed suite is that the paths are not
 * the ones somebody remembered to write down, and a scenario that is the same
 * every cycle gives the same path back. So each cycle a persona gets a fresh
 * combination: a party, a length of stay, a budget, a mood, an awkward detail.
 *
 * The ingredients are deliberately *synthetic and obviously so* — a party of
 * four with a nervous swimmer, a traveller with one free afternoon. No real
 * names, no real addresses, nothing that would look like a person if it ended
 * up in a screenshot of a demo.
 */

const PARTIES = [
  'on your own',
  'with one friend',
  'with your partner',
  'with three friends',
  'with two children',
  'with a group of six',
]

const SHAPES = [
  'you have one free afternoon',
  'you have three days and no plan',
  'you arrive late tonight',
  'you are leaving tomorrow',
  'the weather has turned',
  'you changed your mind about something you already booked',
]

const AWKWARD = [
  'one of you has never surfed',
  'you want to spend as little as possible',
  'you want the most expensive thing available',
  'somebody in the party cannot swim',
  'you want to know exactly what you are being charged for',
  'you are suspicious of anything that sounds like a guarantee',
  'you keep changing the dates',
]

const OWNER_SHAPES = [
  'it is the start of the day and you want the short version',
  'a partner has been waiting on something',
  'you want to know what the month actually earned',
  'somebody asked you whether a partner is insured',
  'you are checking whether anything is about to go wrong',
]

const PARTNER_SHAPES = [
  'you want to see your listing the way a guest sees it',
  'your price has changed',
  'you want to know what you are owed',
  'your certificate is about to expire',
  'you want to publish something yourself',
]

const ADMIN_SHAPES = [
  'you are working the queue from the top',
  'you want to find out what the product refuses',
  'somebody asked whether the demo is healthy',
  'you are checking that nothing verified itself',
]

const ADVERSARY_SHAPES = [
  'you change an identifier in the address bar',
  'you open two tabs and do the same thing twice',
  'you submit a form with a value the page did not offer',
  'you look for a page that forgot to ask who you are',
  'you try to reach a hotel that is not yours',
]

/**
 * Not random: a function of the persona and the cycle.
 *
 * A run that an operator is watching should be reproducible enough to talk
 * about — "the third cycle, the one where the party could not swim" — and
 * `Math.random()` makes every feed a one-off nobody can go back to.
 */
export function scenarioFor(persona: PersonaBrief, cycle: number): string {
  const pick = <T>(list: readonly T[], salt: number): T =>
    list[(cycle * 7 + salt + persona.id.length) % list.length] as T

  switch (persona.id) {
    case 'hotel-owner':
      return `Today ${pick(OWNER_SHAPES, 1)}.`
    case 'supplier-partner':
      return `Today ${pick(PARTNER_SHAPES, 2)}.`
    case 'arc-admin':
      return `Today ${pick(ADMIN_SHAPES, 3)}.`
    case 'adversary':
      return `This time ${pick(ADVERSARY_SHAPES, 4)}.`
    default:
      return `You are travelling ${pick(PARTIES, 5)}, ${pick(SHAPES, 6)}, and ${pick(AWKWARD, 7)}.`
  }
}
