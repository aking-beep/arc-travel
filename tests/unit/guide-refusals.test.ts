import { describe, expect, it } from 'vitest'
import { isRefusedSubject } from '@/modules/discovery/guide-refusals'

/**
 * The local guide's refusal guard.
 *
 * Both halves matter and they pull against each other. Letting a safety or
 * conditions question reach a model holding month-old editorial prose breaks
 * non-negotiable 1; swallowing a question the panel invites answers a
 * reasonable ask with a lecture about borders and nobody ever sees why. Each
 * case below is one or the other, and two of them are bugs this has already
 * had.
 */
describe('the local guide refusal guard', () => {
  it('refuses safety and conditions', () => {
    for (const asked of [
      'Is Zicatela safe?',
      'Is it safe to swim today?',
      'How dangerous is the shore dump?',
      'What is the swell doing?',
      'Any rip currents at Carrizalillo?',
      "What's the surf report?",
      'Is there avalanche risk on the Vallée Blanche?',
    ]) {
      expect(isRefusedSubject(asked), asked).toBe(true)
    }
  })

  it('refuses law, borders and entry', () => {
    for (const asked of [
      'Do I need a visa?',
      'What are the entry requirements?',
      'How long does it take to get through customs?',
      'Is weed legal here?',
      'What does the law say about drones?',
    ]) {
      expect(isRefusedSubject(asked), asked).toBe(true)
    }
  })

  it('refuses health, including the words a stem has to match', () => {
    // `vaccin`, `medic` and `allerg` were inside `\b(…)\b`, so the forms
    // anybody actually types walked straight past them.
    for (const asked of [
      'Which vaccinations do I need?',
      'Is there medical care in town?',
      'I have a shellfish allergy — what should I avoid?',
      'Do I need malaria tablets?',
      'Where is the nearest hospital?',
    ]) {
      expect(isRefusedSubject(asked), asked).toBe(true)
    }
  })

  it('answers the questions the panel invites', () => {
    // "What are the local customs?" was refused as a border question. Every
    // guide has a Local customs section and the panel's opening line offers
    // it, so this is the case the guard must not swallow.
    for (const asked of [
      'What are the local customs?',
      'Is there anything customs-wise I should know about greeting people?',
      'How much should I tip?',
      'What should I wear to dinner?',
      'When is turtle season?',
      'Do I need to speak Spanish?',
      'Can I pay by card?',
      'What is the food like in October?',
    ]) {
      expect(isRefusedSubject(asked), asked).toBe(false)
    }
  })
})
