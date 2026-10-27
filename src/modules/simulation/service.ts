import { timingSafeEqual } from 'node:crypto'

import { prisma } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { forbidden, invalid, notFound } from '@/lib/errors'
import {
  SimulationEventKind,
  SimulationProposalStatus,
  SimulationRunStatus,
  SimulationVerdict,
} from '@/lib/prisma-types'

import { isHarnessPath, relaxationCheck } from './guardrails'
import { formatUsdMinor, isSimulationModel, type SimulationModel } from './pricing'
import {
  feedQuerySchema,
  ingestSchema,
  startRunSchema,
  type FeedQuery,
  type IngestInput,
  type StartRunInput,
} from './schemas'

/**
 * The live simulation.
 *
 * Simulated people drive the deployed product while an operator watches. This
 * module is the half that lives in the app: it authorises the runner, stores
 * what the runner saw, refuses what the runner must not be able to do, and
 * answers the dashboard's feed.
 *
 * It deliberately knows nothing about *how* a persona decides. The runner
 * drives a browser, exactly as a person would, and reaches this module through
 * one authenticated HTTP route — which is what keeps a simulation a user of the
 * product rather than a second, privileged path into it. Non-negotiable 5 is
 * about the product's AI, and this is not that; but the same instinct applies,
 * and the boundary is where it is enforced. See ADR-043.
 */

/**
 * How long a run may say nothing before the dashboard reads it as stalled.
 *
 * The runner heartbeats on every batch. A worker that is killed, loses its
 * network or is closed with the laptop lid says nothing at all, and a panel
 * that shows such a run as RUNNING for ever is a panel that cannot tell "still
 * working" from "dead" — the thing `CLAUDE.md` forbids of a blank panel, in a
 * different costume.
 */
export const STALE_AFTER_MS = 90_000

/** Every simulation surface starts here. Unconfigured means off, never open. */
export function simulationToken(): string {
  const env = getEnv()
  if (!env.SIMULATION_TOKEN) {
    throw notFound('Simulation')
  }
  if (env.ARC_DATA_MODE !== 'demo') {
    /*
     * Unreachable through `getEnv()`, which refuses this combination at boot.
     * Kept because this is the assertion that matters, and a reader of this
     * module should be able to see it rather than trust a check elsewhere.
     */
    throw forbidden('A simulation runs against synthetic data only.')
  }
  return env.SIMULATION_TOKEN
}

/** Constant-time bearer comparison, as the cron routes do it. */
export function authoriseRunner(header: string | null): void {
  const expected = Buffer.from(simulationToken(), 'utf8')
  const presented = Buffer.from((header ?? '').replace(/^Bearer /i, ''), 'utf8')
  if (presented.length !== expected.length) throw forbidden('Unauthorized.')
  if (!timingSafeEqual(presented, expected)) throw forbidden('Unauthorized.')
}

export interface StartedRun {
  id: string
  model: SimulationModel
  budgetMinor: number
}

/**
 * Begin a run.
 *
 * One at a time: a second runner against the same demo would race the first
 * for the same seats and neither feed would describe what happened. An
 * existing run that has stopped heartbeating is closed as stalled rather than
 * blocking a new one for ever.
 */
export async function startRun(raw: unknown): Promise<StartedRun> {
  const input: StartRunInput = startRunSchema.parse(raw)
  if (!isSimulationModel(input.model)) throw invalid('Unknown model.')

  const cutoff = new Date(Date.now() - STALE_AFTER_MS)
  await prisma.simulationRun.updateMany({
    where: { status: SimulationRunStatus.RUNNING, heartbeatAt: { lt: cutoff } },
    data: {
      status: SimulationRunStatus.STALLED,
      stoppedReason: 'The runner stopped reporting. Nothing has been heard from it since.',
      finishedAt: new Date(),
    },
  })

  const live = await prisma.simulationRun.findFirst({
    where: { status: SimulationRunStatus.RUNNING },
    select: { id: true, targetUrl: true },
  })
  if (live) {
    throw invalid(
      `A simulation is already running against ${live.targetUrl}. Stop it before starting another: ` +
        'two runners share one database and would race each other for the same inventory.',
    )
  }

  const run = await prisma.simulationRun.create({
    data: {
      targetUrl: input.targetUrl.replace(/\/$/, ''),
      dataMode: input.dataMode,
      model: input.model,
      budgetMinor: input.budgetMinor,
    },
    select: { id: true },
  })

  return { id: run.id, model: input.model, budgetMinor: input.budgetMinor }
}

export interface IngestResult {
  /** Events stored. A resend of a sequence already held is not an error. */
  eventsStored: number
  proposalsStored: number
  /** Proposals refused for proposing a relaxation, with the reason. */
  refused: Array<{ targetPath: string; because: string }>
  spentMinor: number
  budgetMinor: number
  /** True once the ceiling is reached: the runner stops on this, not on a guess. */
  stop: boolean
  status: SimulationRunStatus
}

/**
 * Store a batch and answer whether to carry on.
 *
 * The budget decision is made here rather than in the runner so there is one
 * arbiter. A runner that computed its own stopping point from its own copy of
 * the prices would be the only thing that knew it had passed the ceiling.
 */
export async function ingest(raw: unknown): Promise<IngestResult> {
  const input: IngestInput = ingestSchema.parse(raw)

  const run = await prisma.simulationRun.findUnique({
    where: { id: input.runId },
    select: { id: true, status: true, budgetMinor: true, spentMinor: true },
  })
  if (!run) throw notFound('Simulation run')
  if (run.status !== SimulationRunStatus.RUNNING) {
    throw invalid(`This run has already finished (${run.status.toLowerCase()}).`)
  }

  const refused: IngestResult['refused'] = []
  const accepted: Array<{
    targetPath: string
    miss: string
    suggestion: string
    fromClientId?: string
  }> = []

  for (const proposal of input.proposals) {
    if (!isHarnessPath(proposal.targetPath)) {
      refused.push({
        targetPath: proposal.targetPath,
        because:
          'a proposal amends a file under `.claude/`. A suggestion about the product is a pull ' +
          'request somebody writes, not a harness amendment.',
      })
      continue
    }
    const verdict = relaxationCheck(proposal)
    if (verdict.relaxes) {
      refused.push({
        targetPath: proposal.targetPath,
        because: verdict.because ?? 'it relaxes a guard.',
      })
      continue
    }
    accepted.push(proposal)
  }

  /*
   * The spend is the runner's running total, not a delta, and it only ever
   * goes up here. A retry of a batch the runner already sent therefore cannot
   * double-count the one number the ceiling is read from.
   */
  const spentMinor = Math.max(run.spentMinor, input.usage.spentMinor)
  const stop = spentMinor >= run.budgetMinor
  const finish = input.finish

  const result = await prisma.$transaction(async (tx) => {
    if (input.events.length > 0) {
      await tx.simulationEvent.createMany({
        data: input.events.map((event) => ({
          runId: run.id,
          clientId: event.clientId,
          sequence: event.sequence,
          kind: SimulationEventKind[event.kind],
          persona: event.persona,
          scenario: event.scenario ?? null,
          step: event.step ?? null,
          summary: event.summary,
          detail: event.detail ?? null,
          path: event.path ?? null,
          verdict: event.verdict ? SimulationVerdict[event.verdict] : null,
          severity: event.severity ?? null,
          costMinor: event.costMinor,
          occurredAt: event.occurredAt,
        })),
        skipDuplicates: true,
      })
    }

    const lastSequence = input.events.at(-1)?.sequence ?? 0

    /*
     * Every refusal is recorded as a `GUARD` event rather than dropped.
     *
     * An operator has to be able to see that a relaxation was proposed. A
     * refusal nobody is told about looks exactly like a simulation that never
     * tried, and the attempt is the more interesting of the two.
     *
     * It is written at the sequence of whatever prompted it, so it reads next
     * to its cause; `clientId` is derived from the run, the batch and the
     * proposal, so a resend of the same batch refuses the same proposal once.
     */
    for (const [index, refusal] of refused.entries()) {
      await tx.simulationEvent.createMany({
        data: [
          {
            runId: run.id,
            clientId: `refused:${lastSequence}:${index}:${refusal.targetPath}`.slice(0, 200),
            sequence: lastSequence,
            kind: SimulationEventKind.GUARD,
            persona: 'harness',
            summary: `Refused a proposed amendment to ${refusal.targetPath}`,
            detail: `Refused because ${refusal.because}`,
            costMinor: 0,
            occurredAt: new Date(),
          },
        ],
        skipDuplicates: true,
      })
    }

    for (const proposal of accepted) {
      const prompting = proposal.fromClientId
        ? await tx.simulationEvent.findUnique({
            where: { runId_clientId: { runId: run.id, clientId: proposal.fromClientId } },
            select: { id: true },
          })
        : null

      await tx.simulationProposal.create({
        data: {
          runId: run.id,
          targetPath: proposal.targetPath,
          miss: proposal.miss,
          suggestion: proposal.suggestion,
          eventId: prompting?.id ?? null,
        },
      })
    }

    const status = finish
      ? SimulationRunStatus[finish.status]
      : stop
        ? SimulationRunStatus.BUDGET_REACHED
        : SimulationRunStatus.RUNNING

    const reason = finish
      ? finish.reason
      : stop
        ? `The spend ceiling of ${formatUsdMinor(run.budgetMinor)} was reached.`
        : null

    return tx.simulationRun.update({
      where: { id: run.id },
      data: {
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        decisions: input.usage.decisions,
        spentMinor,
        heartbeatAt: new Date(),
        status,
        stoppedReason: reason,
        finishedAt: status === SimulationRunStatus.RUNNING ? null : new Date(),
      },
      select: { status: true, spentMinor: true, budgetMinor: true },
    })
  })

  return {
    eventsStored: input.events.length,
    proposalsStored: accepted.length,
    refused,
    spentMinor: result.spentMinor,
    budgetMinor: result.budgetMinor,
    stop: stop || result.status !== SimulationRunStatus.RUNNING,
    status: result.status,
  }
}

/** The operator pressing stop, or the dashboard closing. */
export async function stopRun(runId: string, reason: string): Promise<void> {
  const run = await prisma.simulationRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true },
  })
  if (!run) throw notFound('Simulation run')
  if (run.status !== SimulationRunStatus.RUNNING) return

  await prisma.simulationRun.update({
    where: { id: runId },
    data: {
      status: SimulationRunStatus.COMPLETED,
      stoppedReason: reason.trim().slice(0, 300) || 'Stopped by an operator.',
      finishedAt: new Date(),
    },
  })
}

export interface SimulationFeed {
  run: {
    id: string
    targetUrl: string
    model: string
    status: SimulationRunStatus
    /** Derived, never stored: a RUNNING row whose heartbeat is old is stalled. */
    stalled: boolean
    stoppedReason: string | null
    budgetMinor: number
    spentMinor: number
    inputTokens: number
    outputTokens: number
    decisions: number
    startedAt: Date
    heartbeatAt: Date
    finishedAt: Date | null
    /** Held, failed and errored across the whole run, not just this page. */
    tally: { held: number; failed: number; errored: number; problems: number }
  } | null
  events: Array<{
    id: string
    sequence: number
    kind: SimulationEventKind
    persona: string
    scenario: string | null
    step: string | null
    summary: string
    detail: string | null
    path: string | null
    verdict: SimulationVerdict | null
    severity: string | null
    costMinor: number
    occurredAt: Date
  }>
  proposals: Array<{
    id: string
    targetPath: string
    miss: string
    suggestion: string
    status: SimulationProposalStatus
    createdAt: Date
  }>
  /** The highest sequence returned, for the next poll to carry. */
  cursor: number
}

/**
 * The dashboard's read.
 *
 * Polled rather than streamed, and that is a decision rather than a shortcut:
 * the deployment target runs this route as a serverless function with a
 * duration ceiling, so a held-open `text/event-stream` dies every minute and
 * reconnects — a live panel that blinks. A cursor and a short interval is the
 * same latency with none of that. See ADR-043.
 */
export async function readFeed(raw: unknown): Promise<SimulationFeed> {
  const query: FeedQuery = feedQuerySchema.parse(raw ?? {})

  const run = query.runId
    ? await prisma.simulationRun.findUnique({ where: { id: query.runId } })
    : await prisma.simulationRun.findFirst({ orderBy: { startedAt: 'desc' } })

  if (!run) return { run: null, events: [], proposals: [], cursor: 0 }

  const [events, proposals, held, failed, errored, problems] = await Promise.all([
    prisma.simulationEvent.findMany({
      where: { runId: run.id, sequence: { gt: query.afterSequence } },
      orderBy: { sequence: 'asc' },
      take: query.limit,
    }),
    prisma.simulationProposal.findMany({
      where: { runId: run.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.simulationEvent.count({ where: { runId: run.id, verdict: SimulationVerdict.HELD } }),
    prisma.simulationEvent.count({ where: { runId: run.id, verdict: SimulationVerdict.FAILED } }),
    prisma.simulationEvent.count({ where: { runId: run.id, verdict: SimulationVerdict.ERRORED } }),
    prisma.simulationEvent.count({
      where: { runId: run.id, kind: SimulationEventKind.PROBLEM },
    }),
  ])

  const stalled =
    run.status === SimulationRunStatus.RUNNING &&
    Date.now() - run.heartbeatAt.getTime() > STALE_AFTER_MS

  return {
    run: {
      id: run.id,
      targetUrl: run.targetUrl,
      model: run.model,
      status: run.status,
      stalled,
      stoppedReason: run.stoppedReason,
      budgetMinor: run.budgetMinor,
      spentMinor: run.spentMinor,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      decisions: run.decisions,
      startedAt: run.startedAt,
      heartbeatAt: run.heartbeatAt,
      finishedAt: run.finishedAt,
      tally: { held, failed, errored, problems },
    },
    events: events.map((e) => ({
      id: e.id,
      sequence: e.sequence,
      kind: e.kind,
      persona: e.persona,
      scenario: e.scenario,
      step: e.step,
      summary: e.summary,
      detail: e.detail,
      path: e.path,
      verdict: e.verdict,
      severity: e.severity,
      costMinor: e.costMinor,
      occurredAt: e.occurredAt,
    })),
    proposals: proposals.map((p) => ({
      id: p.id,
      targetPath: p.targetPath,
      miss: p.miss,
      suggestion: p.suggestion,
      status: p.status,
      createdAt: p.createdAt,
    })),
    cursor: events.at(-1)?.sequence ?? query.afterSequence,
  }
}

export interface RunSummary {
  id: string
  targetUrl: string
  model: string
  status: SimulationRunStatus
  startedAt: Date
  finishedAt: Date | null
  spentMinor: number
  decisions: number
  failed: number
}

/** Previous runs, so an empty feed can say "nothing yet" and mean it. */
export async function listRuns(limit = 10): Promise<RunSummary[]> {
  const runs = await prisma.simulationRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 50),
  })

  const failures = await prisma.simulationEvent.groupBy({
    by: ['runId'],
    where: { runId: { in: runs.map((r) => r.id) }, verdict: SimulationVerdict.FAILED },
    _count: { _all: true },
  })
  const byRun = new Map(failures.map((f) => [f.runId, f._count._all]))

  return runs.map((run) => ({
    id: run.id,
    targetUrl: run.targetUrl,
    model: run.model,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    spentMinor: run.spentMinor,
    decisions: run.decisions,
    failed: byRun.get(run.id) ?? 0,
  }))
}

/** An operator's verdict on a proposal. It still becomes a PR by hand. */
export async function decideProposal(
  proposalId: string,
  decision: 'ACCEPTED' | 'DISMISSED',
): Promise<void> {
  const proposal = await prisma.simulationProposal.findUnique({
    where: { id: proposalId },
    select: { id: true },
  })
  if (!proposal) throw notFound('Proposal')

  await prisma.simulationProposal.update({
    where: { id: proposalId },
    data: { status: SimulationProposalStatus[decision] },
  })
}
