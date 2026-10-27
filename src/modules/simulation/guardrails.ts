/**
 * What a simulation may propose, and what it may not.
 *
 * The harness rule (PR #11, `.claude/harness-log.md`) is that an agent closes
 * its work with a proposed amendment to the one file that should have caught
 * the thing, and that nothing applies its own amendment. A simulation that
 * writes up its own findings is the same shape, with one extra hazard: the
 * agent proposing the change is also the thing being refused by it. The cheap
 * way for a persona to stop failing a check is to propose that the check go
 * away.
 *
 * So two rules, enforced here rather than trusted:
 *
 *  1. A proposal names a `.claude/` file. A suggestion about `src/` or
 *     `prisma/` is a change to the product wearing a guardrail's clothes, and
 *     `simulation_proposal_targets_the_harness` refuses it in the database too.
 *  2. A proposal may not *relax* anything. Removing a deny-list entry, turning
 *     outbound messaging on, deleting a non-negotiable, calling a condition
 *     safe, loosening a CHECK: refused, and the refusal is itself recorded as a
 *     `GUARD` event so an operator sees that it was tried.
 *
 * The patterns are deliberately blunt. A false refusal costs a person five
 * minutes of rewording; a false acceptance is a loosened guardrail nobody
 * reviewed.
 */

/** A `.claude/` path, with nothing clever in it. */
export function isHarnessPath(targetPath: string): boolean {
  if (!targetPath.startsWith('.claude/')) return false
  if (targetPath.includes('..')) return false
  if (targetPath.includes('\0') || targetPath.includes('//')) return false
  return targetPath.length <= 200
}

interface RelaxationPattern {
  readonly pattern: RegExp
  /** What the refusal says, in the words of the rule it protects. */
  readonly because: string
}

const RELAXATIONS: readonly RelaxationPattern[] = [
  {
    pattern: /\b(remove|delete|drop|loosen|relax|weaken|soften|bypass|skip|disable|turn off|stop enforcing)\b[^.]{0,80}\b(deny|denylist|deny-list|guard|hook|non-negotiable|constraint|check|assertion|rule|refusal)\b/i,
    because:
      'it proposes removing or weakening a guard. A guardrail is changed by a person in a pull ' +
      'request, never by the thing the guardrail refused.',
  },
  {
    pattern: /\bARC_ENABLE_OUTBOUND_MESSAGING\b[^.]{0,40}\b(true|1|on|enabled?)\b/i,
    because:
      'it proposes turning outbound guest messaging on. That switch is about ARC initiating ' +
      'contact with a guest and it stays off (non-negotiable 6, ADR-040).',
  },
  {
    pattern: /\badd\b[^.]{0,60}\bsafe\b|\b(safe today|is safe|mark(ed)? as safe|safety claim)\b/i,
    because:
      'it proposes language or a field that claims safety. The gate returns `allowed`, never ' +
      '`safe` (non-negotiable 1).',
  },
  {
    pattern: /\b(auto[- ]?(verify|verified|verification)|self[- ]?verif\w*|verify (a |the )?(partner|supplier) (automatically|in code|from the seed))\b/i,
    because:
      'it proposes a route to a verified status outside `/admin`. That route is the only one ' +
      '(non-negotiable 2).',
  },
  {
    pattern: /\b(allow|permit|let)\b[^.]{0,60}\b(agent|simulation|persona|runner)\b[^.]{0,40}\b(edit|write|apply|commit|push|merge)\b/i,
    because:
      'it proposes letting an agent apply its own change. An agent proposes; a person decides.',
  },
  {
    pattern: /\b(NOT VALID|without a migration|edit the applied migration|append to .{0,30}migration)\b/i,
    because:
      'it proposes changing how constraints are applied. That is ADR-036 and ADR-034 territory ' +
      'and belongs in a reviewed pull request.',
  },
  {
    pattern: /\b(pilot|live|production)\b[^.]{0,60}\b(simulation|persona|runner|pressure test)\b|\b(simulat\w+|runner|persona)\b[^.]{0,60}\b(live|production|pilot)\b/i,
    because:
      'it proposes running the simulation somewhere other than the demo. Synthetic data or ' +
      'nothing (ADR-043).',
  },
]

export interface RelaxationVerdict {
  readonly relaxes: boolean
  readonly because?: string
}

/**
 * Whether a suggestion would relax something, judged on its text.
 *
 * Text, not intent: the model wrote it, and a model's own account of whether
 * its suggestion loosens a rule is not evidence. Checked against the
 * suggestion and the miss together, because the loosening is sometimes in the
 * justification rather than the diff.
 */
export function relaxationCheck(input: { miss: string; suggestion: string }): RelaxationVerdict {
  const text = `${input.miss}\n${input.suggestion}`
  for (const { pattern, because } of RELAXATIONS) {
    if (pattern.test(text)) return { relaxes: true, because }
  }
  return { relaxes: false }
}
