import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { prisma } from '@/lib/db'
import { SimulationRunStatus } from '@/lib/prisma-types'
import { ingest, readFeed, startRun, stopRun } from '@/modules/simulation/service'

import { resetDatabase } from '../helpers/factory'

/**
 * The simulation's boundary.
 *
 * Three things are worth a real database here: that a resent batch does not
 * become a second batch, that the spend ceiling is enforced by the deployment
 * rather than by the runner's good manners, and that a run against anything
 * but synthetic data cannot be recorded at all.
 */
let runId: string

const usage = (spentMinor: number) => ({
  inputTokens: 1_000,
  outputTokens: 100,
  decisions: 1,
  spentMinor,
})

const event = (sequence: number, clientId: string) => ({
  clientId,
  sequence,
  kind: 'ACTION' as const,
  persona: 'hotel-guest',
  summary: `step ${sequence}`,
  costMinor: 0,
  occurredAt: new Date().toISOString(),
})

beforeEach(async () => {
  await resetDatabase()
  const run = await startRun({
    targetUrl: 'https://arc-stay-demo.example',
    dataMode: 'demo',
    model: 'claude-sonnet-5-5',
    budgetMinor: 500,
  })
  runId = run.id
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('starting a run', () => {
  it('refuses a second runner while one is live', async () => {
    await expect(
      startRun({
        targetUrl: 'https://arc-stay-demo.example',
        dataMode: 'demo',
        model: 'claude-haiku-5-5',
        budgetMinor: 100,
      }),
    ).rejects.toThrow(/already running/i)
  })

  it('refuses a target that is not a demo', async () => {
    await stopRun(runId, 'done')
    await expect(
      startRun({
        targetUrl: 'https://arc-stay.example',
        dataMode: 'live',
        model: 'claude-sonnet-5-5',
        budgetMinor: 100,
      }),
    ).rejects.toThrow()
  })

  it('cannot be written as anything but a demo, even past the schema', async () => {
    // The database is the backstop: `simulation_run_is_demo_only`. If the
    // service were ever bypassed, there is still nowhere to record a run
    // against a real hotel's data.
    await expect(
      prisma.simulationRun.update({ where: { id: runId }, data: { dataMode: 'live' } }),
    ).rejects.toThrow(/simulation_run_is_demo_only/)
  })
})

describe('ingesting what the runner saw', () => {
  it('stores a batch and answers that the run continues', async () => {
    const result = await ingest({
      runId,
      events: [event(1, '11111111-1111-4111-8111-111111111111')],
      proposals: [],
      usage: usage(3),
    })

    expect(result.eventsStored).toBe(1)
    expect(result.stop).toBe(false)

    const feed = await readFeed({ runId })
    expect(feed.events).toHaveLength(1)
    expect(feed.run?.spentMinor).toBe(3)
  })

  it('treats a resent batch as the batch it already has', async () => {
    const batch = {
      runId,
      events: [event(1, '22222222-2222-4222-8222-222222222222')],
      proposals: [],
      usage: usage(3),
    }

    await ingest(batch)
    await ingest(batch)

    const feed = await readFeed({ runId })
    expect(feed.events).toHaveLength(1)
    // And the spend the ceiling is read from did not double either.
    expect(feed.run?.spentMinor).toBe(3)
  })

  it('never lets the reported spend go backwards', async () => {
    await ingest({ runId, events: [], proposals: [], usage: usage(120) })
    await ingest({ runId, events: [], proposals: [], usage: usage(4) })

    const feed = await readFeed({ runId })
    expect(feed.run?.spentMinor).toBe(120)
  })

  it('stops the run at the ceiling, and says so', async () => {
    const result = await ingest({ runId, events: [], proposals: [], usage: usage(500) })

    expect(result.stop).toBe(true)
    expect(result.status).toBe(SimulationRunStatus.BUDGET_REACHED)

    const feed = await readFeed({ runId })
    expect(feed.run?.stoppedReason).toMatch(/ceiling/i)
    expect(feed.run?.finishedAt).not.toBeNull()
  })

  it('refuses a batch for a run that has finished', async () => {
    await stopRun(runId, 'done')
    await expect(
      ingest({ runId, events: [], proposals: [], usage: usage(1) }),
    ).rejects.toThrow(/already finished/i)
  })
})

describe('proposed amendments', () => {
  it('stores one that amends a harness file', async () => {
    const result = await ingest({
      runId,
      events: [event(1, '33333333-3333-4333-8333-333333333333')],
      proposals: [
        {
          targetPath: '.claude/skills/arc-verify/SKILL.md',
          miss: 'Nothing says to re-run the accessibility spec after a colour change.',
          suggestion: 'Add a line about re-running the accessibility spec.',
          fromClientId: '33333333-3333-4333-8333-333333333333',
        },
      ],
      usage: usage(1),
    })

    expect(result.proposalsStored).toBe(1)
    expect(result.refused).toHaveLength(0)

    const feed = await readFeed({ runId })
    expect(feed.proposals[0]?.targetPath).toBe('.claude/skills/arc-verify/SKILL.md')
    // It reads back to what prompted it rather than standing on its own.
    const stored = await prisma.simulationProposal.findFirst({ where: { runId } })
    expect(stored?.eventId).not.toBeNull()
  })

  it('refuses one that would relax a guard, and records the attempt', async () => {
    const result = await ingest({
      runId,
      events: [event(1, '44444444-4444-4444-8444-444444444444')],
      proposals: [
        {
          targetPath: '.claude/hooks/deny-dangerous.mjs',
          miss: 'The hook refused the runner.',
          suggestion: 'Remove the deny-list entry so the simulation can reset the schema.',
        },
      ],
      usage: usage(1),
    })

    expect(result.proposalsStored).toBe(0)
    expect(result.refused).toHaveLength(1)

    const feed = await readFeed({ runId })
    expect(feed.proposals).toHaveLength(0)
    // The attempt is in the feed, because a refusal nobody is told about looks
    // exactly like a simulation that never tried.
    const guard = feed.events.find((e) => e.kind === 'GUARD')
    expect(guard?.summary).toMatch(/refused a proposed amendment/i)
  })

  it('refuses one that names the product rather than the harness', async () => {
    const result = await ingest({
      runId,
      events: [],
      proposals: [
        {
          targetPath: 'src/modules/destination/conditions.ts',
          miss: 'The gate was strict.',
          suggestion: 'Widen the window the gate allows.',
        },
      ],
      usage: usage(1),
    })

    expect(result.refused[0]?.because).toMatch(/\.claude/)
  })
})

describe('the feed', () => {
  it('returns only what the dashboard has not seen', async () => {
    await ingest({
      runId,
      events: [
        event(1, '55555555-5555-4555-8555-555555555551'),
        event(2, '55555555-5555-4555-8555-555555555552'),
        event(3, '55555555-5555-4555-8555-555555555553'),
      ],
      proposals: [],
      usage: usage(1),
    })

    const first = await readFeed({ runId })
    expect(first.events).toHaveLength(3)
    expect(first.cursor).toBe(3)

    const next = await readFeed({ runId, afterSequence: first.cursor })
    expect(next.events).toHaveLength(0)
    // And the run's own totals still come back, so a quiet poll is not a blank.
    expect(next.run?.id).toBe(runId)
  })

  it('reads a run that stopped reporting as stalled rather than running', async () => {
    await prisma.simulationRun.update({
      where: { id: runId },
      data: { heartbeatAt: new Date(Date.now() - 10 * 60_000) },
    })

    const feed = await readFeed({ runId })
    expect(feed.run?.status).toBe(SimulationRunStatus.RUNNING)
    expect(feed.run?.stalled).toBe(true)
  })
})
