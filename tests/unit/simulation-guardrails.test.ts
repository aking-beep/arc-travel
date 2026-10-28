import { describe, expect, it } from 'vitest'

import { isHarnessPath, relaxationCheck } from '@/modules/simulation/guardrails'

/**
 * What a simulation may propose.
 *
 * The hazard this guards is specific: the agent writing the proposal is also
 * the thing the guardrail refused, and the cheapest way to stop failing a
 * check is to propose that the check go away. Both halves are tested — that a
 * relaxation is refused, and that an ordinary amendment still gets through,
 * because a refusal that catches everything is the same as having no feedback
 * loop at all.
 */
describe('a proposal names a harness file', () => {
  it('accepts a file under .claude/', () => {
    expect(isHarnessPath('.claude/skills/arc-verify/SKILL.md')).toBe(true)
    expect(isHarnessPath('.claude/agents/qa-reviewer.md')).toBe(true)
  })

  it('refuses the product, a traversal and anything outside', () => {
    expect(isHarnessPath('src/modules/inventory/service.ts')).toBe(false)
    expect(isHarnessPath('prisma/schema.prisma')).toBe(false)
    expect(isHarnessPath('.claude/../src/lib/env.ts')).toBe(false)
    expect(isHarnessPath('/etc/passwd')).toBe(false)
    expect(isHarnessPath('.claude//hooks/deny-dangerous.mjs')).toBe(false)
  })
})

describe('a proposal may not relax anything', () => {
  const relaxations = [
    {
      miss: 'The hook refused a legitimate command.',
      suggestion: 'Remove the deny-list entry for prisma db push so the runner can reset state.',
    },
    {
      miss: 'The persona could not send a message.',
      suggestion: 'Set ARC_ENABLE_OUTBOUND_MESSAGING to true in the demo so the flow completes.',
    },
    {
      miss: 'The guest could not tell whether the beach was usable.',
      suggestion: 'Add a "safe today" badge to the conditions card.',
    },
    {
      miss: 'Verification is slow.',
      suggestion: 'Let a partner self-verify when their certificate is on file.',
    },
    {
      miss: 'The simulation had too little data.',
      suggestion: 'Allow the runner to point at the live hotel project for a richer run.',
    },
    {
      miss: 'The proposal queue is tedious.',
      suggestion: 'Let the agent apply its own amendment to .claude/ and open the PR itself.',
    },
  ]

  for (const [index, proposal] of relaxations.entries()) {
    it(`refuses relaxation ${index + 1}`, () => {
      const verdict = relaxationCheck(proposal)
      expect(verdict.relaxes).toBe(true)
      expect(verdict.because).toBeTruthy()
    })
  }

  it('lets an ordinary amendment through', () => {
    expect(
      relaxationCheck({
        miss: 'Nothing in arc-verify says to re-run the accessibility spec after a colour change.',
        suggestion:
          'Add a line to .claude/skills/arc-verify: a change to a --color-sand-* value re-runs ' +
          'the accessibility spec, because those lightness values are set by measured contrast.',
      }).relaxes,
    ).toBe(false)

    expect(
      relaxationCheck({
        miss: 'The guest persona reached checkout with a stale price and no reviewer looked at it.',
        suggestion:
          'Add a path-to-reviewer row so a diff touching src/modules/commerce always gets the ' +
          'data reviewer as well as the architecture reviewer.',
      }).relaxes,
    ).toBe(false)
  })
})
