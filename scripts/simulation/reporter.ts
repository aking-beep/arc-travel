import { randomUUID } from 'node:crypto'

import { nanosToMinor } from '../../src/modules/simulation/pricing'

/**
 * Everything the runner says, and the only thing it listens to.
 *
 * Events are queued as they happen and flushed in batches, because a persona
 * produces several per step and one request each would make the feed's latency
 * the network's problem. Each carries a `clientId`, so a batch the runner was
 * not sure landed can simply be sent again.
 *
 * The flush response is the runner's instruction: `stop` is the spend
 * ceiling's verdict, decided by the deployment rather than here. The runner
 * holds the prices and the token counts; the deployment holds the budget. One
 * of them has to be the arbiter, and it should be the one the operator can
 * see.
 */

export interface QueuedEvent {
  kind: 'SCENARIO' | 'DECISION' | 'ACTION' | 'CHECK' | 'PROBLEM' | 'GUARD' | 'NOTE'
  persona: string
  scenario?: string
  step?: string
  summary: string
  detail?: string
  path?: string
  verdict?: 'HELD' | 'FAILED' | 'ERRORED'
  severity?: 'blocker' | 'major' | 'minor' | 'info'
  costMinor?: number
}

interface QueuedProposal {
  targetPath: string
  miss: string
  suggestion: string
  fromClientId?: string
}

export interface FlushVerdict {
  stop: boolean
  reason: string
}

interface Totals {
  usage: { inputTokens: number; outputTokens: number }
  nanos: number
}

/** Events per request. Enough to batch a step, small enough to retry cheaply. */
const BATCH = 40

export class Reporter {
  private readonly events: Array<QueuedEvent & { clientId: string; sequence: number; occurredAt: string }> = []
  private readonly proposals: QueuedProposal[] = []
  private sequence = 0
  private lastClientId: string | null = null

  constructor(
    private readonly runId: string,
    private readonly token: string,
    private readonly baseUrl: string,
  ) {}

  queue(event: QueuedEvent): string {
    this.sequence += 1
    const clientId = randomUUID()
    this.events.push({
      ...event,
      clientId,
      sequence: this.sequence,
      occurredAt: new Date().toISOString(),
    })
    this.lastClientId = clientId
    console.log(`  ${event.kind.padEnd(8)} ${event.persona.padEnd(18)} ${event.summary}`)
    return clientId
  }

  /** A proposal belongs to whatever was last reported, which is its cause. */
  propose(proposal: Omit<QueuedProposal, 'fromClientId'>): void {
    this.proposals.push({ ...proposal, fromClientId: this.lastClientId ?? undefined })
  }

  async flush(totals: Totals): Promise<FlushVerdict> {
    if (this.events.length === 0 && this.proposals.length === 0) {
      return { stop: false, reason: '' }
    }

    const batch = this.events.splice(0, BATCH)
    const proposals = this.proposals.splice(0, 20)

    try {
      const response = await this.send({
        runId: this.runId,
        events: batch,
        proposals,
        usage: {
          inputTokens: totals.usage.inputTokens,
          outputTokens: totals.usage.outputTokens,
          decisions: this.decisions(batch),
          spentMinor: nanosToMinor(totals.nanos),
        },
      })

      for (const refusal of response.refused ?? []) {
        console.log(`  REFUSED  harness            ${refusal.targetPath}: ${refusal.because}`)
      }

      return {
        stop: Boolean(response.stop),
        reason: response.stop ? `spent ${response.spentMinor} of ${response.budgetMinor} cents` : '',
      }
    } catch (error) {
      /*
       * A failed flush puts the batch back and carries on.
       *
       * The dashboard losing a few seconds of feed because a laptop changed
       * network is not a reason to end a run an operator is watching; the
       * events are re-sent with the same `clientId`s, so nothing duplicates.
       */
      this.events.unshift(...batch)
      this.proposals.unshift(...proposals)
      console.warn(`  (feed unavailable: ${error instanceof Error ? error.message : String(error)})`)
      return { stop: false, reason: '' }
    }
  }

  async finish(
    status: 'COMPLETED' | 'BUDGET_REACHED' | 'FAILED',
    reason: string,
    totals: Totals,
  ): Promise<void> {
    const batch = this.events.splice(0, this.events.length)
    const proposals = this.proposals.splice(0, this.proposals.length)
    try {
      await this.send({
        runId: this.runId,
        events: batch.slice(0, 100),
        proposals: proposals.slice(0, 20),
        usage: {
          inputTokens: totals.usage.inputTokens,
          outputTokens: totals.usage.outputTokens,
          decisions: this.decisions(batch),
          spentMinor: nanosToMinor(totals.nanos),
        },
        finish: { status, reason: reason.slice(0, 300) || 'Finished.' },
      })
    } catch (error) {
      console.warn(`  (could not report the ending: ${error instanceof Error ? error.message : String(error)})`)
    }
  }

  /** Decisions are the denominator of cost per decision, so they are counted. */
  private decisions(batch: Array<{ kind: string }>): number {
    this.decisionCount += batch.filter((event) => event.kind === 'DECISION').length
    return this.decisionCount
  }

  private decisionCount = 0

  private async send(body: unknown): Promise<{
    stop?: boolean
    spentMinor?: number
    budgetMinor?: number
    refused?: Array<{ targetPath: string; because: string }>
  }> {
    const response = await fetch(`${this.baseUrl}/api/simulation/ingest`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`ingest answered ${response.status}`)
    return (await response.json()) as { stop?: boolean }
  }
}
