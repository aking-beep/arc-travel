import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import {
  costNanos,
  type SimulationModel,
  type TokenUsage,
} from '../../src/modules/simulation/pricing'
import type { Observation } from './observe'
import type { PersonaBrief } from './personas'
import { UNIVERSAL_INVARIANTS } from './personas'

/**
 * One step of a simulated person's judgement.
 *
 * ## One call, three jobs
 *
 * Each call sees the page the last action led to and answers three things at
 * once: whether the expectation it stated last time held, what this person
 * does next, and what it expects of the product as a result. Judging the
 * previous expectation here rather than in a second call halves the bill
 * without losing anything — the evidence for the judgement is the page in
 * front of it, which is exactly what this call already has.
 *
 * ## Why the output is parsed rather than schema-constrained
 *
 * The structured-output parameters are the better tool and they move: a
 * runner that 400s against a parameter change is a runner that stops working
 * on a Tuesday for a reason nobody who opens the dashboard can diagnose. A
 * fenced JSON object, parsed leniently, validated strictly by Zod and retried
 * once with the validation error attached, is what survives. The strictness
 * that matters is the Zod parse, and that is ours.
 */

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), index: z.number().int().min(1) }),
  z.object({ type: z.literal('fill'), index: z.number().int().min(1), value: z.string().max(200) }),
  z.object({ type: z.literal('select'), index: z.number().int().min(1), value: z.string().max(120) }),
  z.object({ type: z.literal('goto'), path: z.string().max(200) }),
  z.object({ type: z.literal('back') }),
  /** The person is satisfied, or stuck. Either way the scenario ends. */
  z.object({ type: z.literal('finish'), because: z.string().max(300) }),
])

export type SimulatedAction = z.infer<typeof actionSchema>

const decisionSchema = z.object({
  /** Judgement on the expectation stated last step, if there was one. */
  previous: z
    .object({
      held: z.boolean(),
      evidence: z.string().max(600),
    })
    .nullable()
    .optional(),
  /** What this person is doing, in their own words, one line. */
  doing: z.string().min(1).max(300),
  action: actionSchema,
  /** What the product should do in response, if anything is worth checking. */
  expectation: z
    .object({
      text: z.string().min(1).max(300),
      severity: z.enum(['blocker', 'major', 'minor', 'info']),
    })
    .nullable()
    .optional(),
  /** A harness file that should have caught something that just did not hold. */
  proposal: z
    .object({
      targetPath: z.string().max(200),
      miss: z.string().max(400),
      suggestion: z.string().max(2_000),
    })
    .nullable()
    .optional(),
})

export type Decision = z.infer<typeof decisionSchema>

export interface DecisionResult {
  readonly decision: Decision
  readonly usage: TokenUsage
  readonly costNanos: number
}

export interface DecisionRequest {
  readonly persona: PersonaBrief
  readonly scenario: string
  readonly observation: Observation
  /** The last few steps, so the person has a memory of their own journey. */
  readonly history: readonly string[]
  readonly pendingExpectation: string | null
}

const SYSTEM = `You are simulating one person using a hotel's travel product, as a usability and
assurance exercise against a demonstration deployment whose data is entirely synthetic.

You are the person, not a tester reciting a script. Pursue the goal the way somebody with that goal
would: read the page, press the thing that looks right, give up on a dead end and try another way.

You also watch for promises the product makes about itself. When something you can see contradicts
one of the listed invariants, say so plainly in an expectation that did not hold, with the words on
the page as evidence. Quote what you saw; do not paraphrase it into something stronger.

Rules about what you may propose:
- You may propose an amendment to a file under .claude/ when something that did not hold should
  have been caught by the harness.
- You may never propose removing, loosening or bypassing a guard, a non-negotiable, a deny-list
  entry, a database constraint or a check. If the product refused you, the refusal is the product
  working.

Answer with one JSON object and nothing else. No prose before or after, no code fence.`

export class Decider {
  private readonly client: Anthropic
  private usage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
  private nanos = 0
  private calls = 0

  constructor(
    private readonly model: SimulationModel,
    apiKey: string,
  ) {
    this.client = new Anthropic({ apiKey })
  }

  get totals(): { usage: TokenUsage; nanos: number; calls: number } {
    return { usage: this.usage, nanos: this.nanos, calls: this.calls }
  }

  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const prompt = render(request)

    let lastError: string | null = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1_200,
        system: SYSTEM,
        output_config: { effort: 'low' },
        messages: [
          {
            role: 'user',
            content: lastError ? `${prompt}\n\nYour last answer was rejected: ${lastError}` : prompt,
          },
        ],
      })

      const used: TokenUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      }
      this.account(used)

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')

      const parsed = parseDecision(text)
      if (parsed.ok) {
        return {
          decision: parsed.value,
          usage: used,
          costNanos: costNanos(this.model, used),
        }
      }
      lastError = parsed.error
    }

    /*
     * Two malformed answers in a row is a fact about the run, not an
     * exception: the persona finishes this scenario and the next one starts.
     * Throwing here would end a simulation an operator is watching because one
     * answer came back with a stray sentence in front of it.
     */
    return {
      decision: {
        doing: 'Gave up on this scenario: the decision could not be read.',
        action: { type: 'finish', because: lastError ?? 'unparseable decision' },
      },
      usage: { inputTokens: 0, outputTokens: 0 },
      costNanos: 0,
    }
  }

  private account(used: TokenUsage): void {
    this.usage = {
      inputTokens: this.usage.inputTokens + used.inputTokens,
      outputTokens: this.usage.outputTokens + used.outputTokens,
    }
    this.nanos += costNanos(this.model, used)
    this.calls += 1
  }
}

function render(request: DecisionRequest): string {
  const { persona, observation } = request

  const affordances = observation.affordances
    .map((a) => `  ${a.index}. [${a.kind}] ${a.name}${a.value ? ` (currently "${a.value}")` : ''}`)
    .join('\n')

  return [
    `You are ${persona.name}.`,
    `Your goal: ${persona.goal}`,
    `What you know: ${persona.knows.join(' ')}`,
    '',
    'This scenario: ' + request.scenario,
    '',
    'Things that must never happen to you:',
    ...persona.mustNeverHappen.map((rule) => `- ${rule}`),
    ...UNIVERSAL_INVARIANTS.map((rule) => `- ${rule}`),
    '',
    request.history.length > 0 ? `What you have done so far:\n${request.history.map((h) => `- ${h}`).join('\n')}` : 'You have just arrived.',
    '',
    request.pendingExpectation
      ? `Last step you expected: ${request.pendingExpectation}\nJudge it against the page below, in "previous".`
      : 'You expected nothing in particular from the last step; set "previous" to null.',
    '',
    observation.path
      ? `You are on ${observation.path} — "${observation.title}"`
      : `You have left ARC Stay and are on ${observation.offOrigin} — "${observation.title}". ` +
        'Going back is almost certainly what you want.',
    observation.heading ? `Heading: ${observation.heading}` : '',
    '',
    'What the page says:',
    observation.text,
    '',
    'What you can do (choose by number):',
    affordances || '  (nothing interactive is visible)',
    '',
    'Answer with this JSON object:',
    '{',
    '  "previous": { "held": true|false, "evidence": "what the page showed" } | null,',
    '  "doing": "one line, what you are doing and why",',
    '  "action": { "type": "click"|"fill"|"select"|"goto"|"back"|"finish", "index": n, "value": "…", "path": "/…", "because": "…" },',
    '  "expectation": { "text": "what the product should now do", "severity": "blocker"|"major"|"minor"|"info" } | null,',
    '  "proposal": { "targetPath": ".claude/…", "miss": "…", "suggestion": "…" } | null',
    '}',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

export type ParseResult = { ok: true; value: Decision } | { ok: false; error: string }

/**
 * Lenient about the wrapping, strict about the content.
 *
 * A model asked for JSON sometimes fences it or writes a sentence first. That
 * is not worth a failed step, so the object is extracted; what it contains is
 * then held to the schema exactly, because the action in it is about to be
 * carried out in a browser.
 */
export function parseDecision(text: string): ParseResult {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced?.[1] ?? text).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) return { ok: false, error: 'no JSON object found' }

  let candidate: unknown
  try {
    candidate = JSON.parse(body.slice(start, end + 1))
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'invalid JSON' }
  }

  const result = decisionSchema.safeParse(candidate)
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  }
  return { ok: true, value: result.data }
}
