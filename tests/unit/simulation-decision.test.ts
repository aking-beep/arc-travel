import { describe, expect, it } from 'vitest'

import { parseDecision } from '../../scripts/simulation/decide'
import { ingestSchema } from '../../src/modules/simulation/schemas'

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

/**
 * What the runner may call a path.
 *
 * `observe` reports the page's path, and a persona can leave the product by
 * clicking a link in content. It used to report the whole URL in that case,
 * which the schema refuses — and the reporter re-sends a refused batch, so one
 * off-origin step wedged the feed for the rest of the run while the model kept
 * billing. Two rules, and the second is why the first cannot simply be relaxed.
 */
describe('the path a runner may report', () => {
  const batch = (path: string) => ({
    runId: '11111111-1111-4111-8111-111111111111',
    events: [
      {
        clientId: '22222222-2222-4222-8222-222222222222',
        sequence: 1,
        kind: 'ACTION' as const,
        persona: 'hotel-guest',
        summary: 'looked at a page',
        path,
        costMinor: 0,
        occurredAt: new Date().toISOString(),
      },
    ],
    proposals: [],
    usage: { inputTokens: 1, outputTokens: 1, decisions: 1, spentMinor: 0 },
  })

  it('takes a path inside the product', () => {
    expect(ingestSchema.safeParse(batch('/owner/revenue')).success).toBe(true)
  })

  it('refuses a full URL, because a URL carries whatever is in its query', () => {
    expect(ingestSchema.safeParse(batch('https://example.com/g/abc')).success).toBe(false)
  })

  it('refuses a protocol-relative URL, which a browser treats as absolute', () => {
    expect(ingestSchema.safeParse(batch('//example.com/g/abc')).success).toBe(false)
  })
})
