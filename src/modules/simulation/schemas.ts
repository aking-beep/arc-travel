import { z } from 'zod'

import { SIMULATION_MODEL_IDS } from './pricing'

/**
 * What the runner is allowed to say.
 *
 * The runner is a process on somebody's machine holding a bearer token, and
 * everything it sends is rendered back to an operator as a report of what the
 * product did. So this is a boundary like any other public form: strict, with
 * every length bounded, and parsed by the service rather than by the route
 * (`CLAUDE.md`, Validation).
 */

const trimmed = (max: number) => z.string().trim().min(1).max(max)

/** A path inside the product, never a full URL. A token in a URL is a credential. */
const appPath = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v.startsWith('/'), 'A path starts with "/".')
  .refine((v) => !/^\/\//.test(v), 'A protocol-relative URL is not a path.')

export const severityValues = ['blocker', 'major', 'minor', 'info'] as const

export const startRunSchema = z
  .object({
    targetUrl: z.string().trim().url().max(300),
    /**
     * What the target's own health endpoint said. The runner reads it rather
     * than being told, and only `demo` is accepted — here, and again by
     * `simulation_run_is_demo_only`.
     */
    dataMode: z.literal('demo'),
    model: z.enum(SIMULATION_MODEL_IDS),
    /**
     * The ceiling, in USD cents. Bounded at both ends: a run with no cap is
     * the failure mode this whole file exists to prevent, and a cap of $200 an
     * operator meant as $2 is the other one.
     */
    budgetMinor: z.coerce.number().int().min(10).max(20_000),
  })
  .strict()

export type StartRunInput = z.infer<typeof startRunSchema>

export const simulationEventSchema = z
  .object({
    /**
     * The runner's own id for this event, and the whole of what makes a resend
     * idempotent. A batch the runner was not sure landed is sent again with
     * the same ids, and the unique `[runId, clientId]` makes the second copy a
     * no-op rather than a second line in the feed.
     */
    clientId: z.string().uuid(),
    /** Ordering, assigned by the runner. Not unique: see `SimulationEvent`. */
    sequence: z.number().int().min(1).max(1_000_000),
    kind: z.enum(['SCENARIO', 'DECISION', 'ACTION', 'CHECK', 'PROBLEM', 'GUARD', 'NOTE']),
    persona: trimmed(60),
    scenario: trimmed(200).optional(),
    step: trimmed(80).optional(),
    summary: trimmed(400),
    detail: z.string().trim().max(4_000).optional(),
    path: appPath.optional(),
    verdict: z.enum(['HELD', 'FAILED', 'ERRORED']).optional(),
    severity: z.enum(severityValues).optional(),
    /** This decision's own cost in USD cents. Zero for everything else. */
    costMinor: z.number().int().min(0).max(100_000).default(0),
    occurredAt: z.coerce.date(),
  })
  .strict()
  .refine(
    (e) => (e.kind === 'CHECK') === (e.verdict !== undefined),
    'A verdict belongs to a CHECK event, and every CHECK carries one.',
  )

export type SimulationEventInput = z.infer<typeof simulationEventSchema>

export const simulationProposalSchema = z
  .object({
    /**
     * The runner's own id for this proposal. A resent batch proposes the same
     * amendment once, for the reason `simulationEventSchema.clientId` exists.
     */
    clientId: z.string().uuid(),
    /** A `.claude/` file. Checked again by `isHarnessPath` and by the database. */
    targetPath: trimmed(200),
    miss: trimmed(400),
    suggestion: trimmed(4_000),
    /** The `clientId` of the event that prompted it, so it reads back to its cause. */
    fromClientId: z.string().uuid().optional(),
  })
  .strict()

export type SimulationProposalInput = z.infer<typeof simulationProposalSchema>

export const ingestSchema = z
  .object({
    runId: z.string().uuid(),
    /**
     * Batched, because a persona produces several events per step and one
     * request per event would make the feed's latency the network's problem.
     * Bounded, because this writes rows.
     */
    events: z.array(simulationEventSchema).max(100).default([]),
    proposals: z.array(simulationProposalSchema).max(20).default([]),
    /**
     * The run's totals so far, not a delta. Idempotent on a retry: a resend
     * cannot double-count the spend the cap is read from.
     */
    usage: z
      .object({
        inputTokens: z.number().int().min(0),
        outputTokens: z.number().int().min(0),
        decisions: z.number().int().min(0),
        spentMinor: z.number().int().min(0),
      })
      .strict(),
    /** Only the endings the runner may declare. A stall is derived, not sent. */
    finish: z
      .object({
        status: z.enum(['COMPLETED', 'BUDGET_REACHED', 'FAILED']),
        reason: trimmed(300),
      })
      .strict()
      .optional(),
  })
  .strict()

export type IngestInput = z.infer<typeof ingestSchema>

export const feedQuerySchema = z
  .object({
    runId: z.string().uuid().optional(),
    /** Events after this sequence. The dashboard holds what it already has. */
    afterSequence: z.coerce.number().int().min(0).max(1_000_000).default(0),
    limit: z.coerce.number().int().min(1).max(300).default(200),
  })
  .strict()

export type FeedQuery = z.infer<typeof feedQuerySchema>
