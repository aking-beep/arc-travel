import { describe, expect, it } from 'vitest'

import { parseDecision } from '../../scripts/simulation/decide'

/**
 * Reading a decision.
 *
 * The runner asks for one JSON object and a model sometimes fences it, prefaces
 * it, or sends something that does not fit the shape. The wrapping is forgiven
 * — a step should not fail over a stray sentence — and the contents are not,
 * because the action inside is about to be carried out in a browser.
 */
const valid = {
  previous: { held: true, evidence: 'The page showed "Not verified by ARC".' },
  doing: 'Opening the partner list to see who is waiting.',
  action: { type: 'click', index: 3 },
  expectation: { text: 'The list names the partner and their standing.', severity: 'major' },
  proposal: null,
}

describe('parsing a decision', () => {
  it('reads a bare object', () => {
    const result = parseDecision(JSON.stringify(valid))
    expect(result.ok).toBe(true)
  })

  it('reads one inside a code fence', () => {
    const result = parseDecision('```json\n' + JSON.stringify(valid) + '\n```')
    expect(result.ok).toBe(true)
  })

  it('reads one with a sentence in front of it', () => {
    const result = parseDecision(`Here is what I would do.\n\n${JSON.stringify(valid)}`)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.action.type).toBe('click')
  })

  it('refuses an action that is not one of the five', () => {
    const result = parseDecision(
      JSON.stringify({ ...valid, action: { type: 'evaluate', script: 'window.close()' } }),
    )
    expect(result.ok).toBe(false)
  })

  it('refuses a click with no target', () => {
    const result = parseDecision(JSON.stringify({ ...valid, action: { type: 'click' } }))
    expect(result.ok).toBe(false)
  })

  it('refuses prose with no object in it at all', () => {
    const result = parseDecision('I would press the second button, I think.')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/no JSON object/i)
  })

  it('accepts a decision that expects nothing and judges nothing', () => {
    const result = parseDecision(
      JSON.stringify({
        doing: 'Reading the page before doing anything.',
        action: { type: 'finish', because: 'Nothing here to do.' },
        previous: null,
        expectation: null,
      }),
    )
    expect(result.ok).toBe(true)
  })
})
