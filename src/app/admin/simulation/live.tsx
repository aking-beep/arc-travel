'use client'

import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleSlash, Gauge, Lightbulb, Radio } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/states'
import { emptyFormState } from '@/lib/form-state'
import { formatUsdMinor } from '@/modules/simulation/pricing'

import { decideProposalAction, stopRunAction } from './actions'
import type { SerialisedFeed } from './page'

/**
 * The live panels.
 *
 * A client component for one reason: it polls. Everything it renders arrives
 * either as a server-computed prop or as a feed row — it formats, and it never
 * reads the clock. "Stalled" in particular is decided by the server, because a
 * browser tab that has been asleep has a clock with its own opinions.
 *
 * Polling rather than an event stream: the deployment target runs the feed
 * route as a serverless function with a duration ceiling, so a held-open
 * stream dies and reconnects on a timer. See ADR-043.
 */
const POLL_MS = 2_000

/**
 * How often to look when there is nothing live to watch.
 *
 * Not "never": a dashboard that stops polling the moment a run ends can never
 * notice the next one starting, which is exactly the state an operator is in
 * when they open this page and *then* start the runner. Slow enough that a
 * page left open overnight is not a load generator.
 */
const IDLE_POLL_MS = 10_000

/** What the feed keeps in the page. Older rows stay in the database. */
const MAX_EVENTS = 500

type Feed = SerialisedFeed
type FeedEvent = Feed['events'][number]
type FeedProposal = Feed['proposals'][number]

interface RunRow {
  id: string
  targetUrl: string
  model: string
  status: string
  startedAt: string
  finishedAt: string | null
  spent: string
  decisions: number
  failed: number
}

export function LiveSimulation({
  initialFeed,
  runs,
  configured,
  defaultModel,
}: {
  initialFeed: Feed
  runs: RunRow[]
  configured: boolean
  defaultModel: string
}) {
  const [feed, setFeed] = useState<Feed>(initialFeed)
  const [events, setEvents] = useState<FeedEvent[]>(initialFeed.events)
  const [error, setError] = useState<string | null>(null)
  const [polling, setPolling] = useState(false)
  const cursor = useRef(initialFeed.cursor)
  /*
   * The run being followed, in a ref rather than read out of state inside the
   * poll. The poll would otherwise depend on an object that every poll
   * replaces, which restarts the interval on every tick and is the kind of
   * thing the React compiler refuses to memoize.
   */
  const followedRun = useRef<string | null>(initialFeed.run?.id ?? null)

  const live = feed.run?.status === 'RUNNING' && !feed.run.stalled

  const poll = useCallback(async (follow: boolean) => {
    try {
      setPolling(true)
      /*
       * Pinned to the run while it is live, and deliberately unpinned when it
       * is not: an idle poll asks for the latest run, so the next one starting
       * replaces this one on the page rather than being invisible until a
       * reload.
       *
       * An unpinned poll also asks from the beginning. The cursor belongs to
       * the run it was counted in, and carrying it across meant a new run's
       * first events — the ones numbered below where the last run finished —
       * were filtered out by the query and never appeared at all.
       */
      const query = new URLSearchParams({ after: follow ? String(cursor.current) : '0' })
      if (follow && followedRun.current) query.set('runId', followedRun.current)

      const response = await fetch(`/api/simulation/feed?${query.toString()}`, {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`The feed answered ${response.status}.`)

      const next = (await response.json()) as Feed
      const changed = next.run?.id !== followedRun.current
      followedRun.current = next.run?.id ?? null

      setFeed(next)
      if (changed || !follow) {
        // A full answer replaces what is held rather than being appended to
        // it, which is what makes an unpinned poll safe to repeat.
        cursor.current = next.cursor
        setEvents(next.events)
      } else if (next.events.length > 0) {
        cursor.current = next.cursor
        setEvents((held) => [...held, ...next.events].slice(-MAX_EVENTS))
      }
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The feed could not be read.')
    } finally {
      setPolling(false)
    }
  }, [])

  useEffect(() => {
    /*
     * Two speeds rather than on and off. A finished run produces no more
     * events, so watching it closely is a serverless function polled all night
     * for nothing; but stopping entirely means the page an operator opened
     * *before* starting the runner never notices that it started.
     */
    const timer = setInterval(() => void poll(live), live ? POLL_MS : IDLE_POLL_MS)
    return () => clearInterval(timer)
  }, [live, poll])

  if (!configured) {
    return (
      <ErrorState
        title="No runner is configured for this deployment"
        description={
          'SIMULATION_TOKEN is unset, so the ingest route refuses every caller rather than ' +
          'accepting an anonymous one. Set it on the demo deployment — and only there: the ' +
          'variable is refused outside ARC_DATA_MODE=demo.'
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      <RunHeader
        feed={feed}
        live={live}
        polling={polling}
        error={error}
        onRetry={() => void poll(live)}
      />

      {feed.run ? (
        <div className="grid gap-5 lg:grid-cols-3">
          <FeedPanel
            title="What they are doing"
            icon={<Radio className="size-4" aria-hidden />}
            events={events.filter((e) => ['SCENARIO', 'DECISION', 'ACTION', 'NOTE'].includes(e.kind))}
            emptyTitle="No steps yet"
            emptyHint="The first persona is signing in."
            live={live}
          />
          <FeedPanel
            title="What held, and what did not"
            icon={<CheckCircle2 className="size-4" aria-hidden />}
            events={events.filter((e) => e.kind === 'CHECK' || e.kind === 'PROBLEM')}
            emptyTitle="No verdicts yet"
            emptyHint="A verdict appears when a persona expects something of the product."
            live={live}
          />
          <GuardPanel
            events={events.filter((e) => e.kind === 'GUARD')}
            proposals={feed.proposals}
            live={live}
          />
        </div>
      ) : (
        <StartInstructions defaultModel={defaultModel} />
      )}

      <PreviousRuns runs={runs} />
    </div>
  )
}

function RunHeader({
  feed,
  live,
  polling,
  error,
  onRetry,
}: {
  feed: Feed
  live: boolean
  polling: boolean
  error: string | null
  onRetry: () => void
}) {
  const [state, action, pending] = useActionState(stopRunAction, emptyFormState)
  const run = feed.run

  if (!run) {
    return (
      <EmptyState
        title="Nothing has run yet"
        description="Start the runner against the demo and this page fills as it works."
        icon={<Gauge className="size-6" aria-hidden />}
      />
    )
  }

  const tone =
    run.stalled || run.status === 'FAILED'
      ? 'danger'
      : run.status === 'RUNNING'
        ? 'success'
        : run.status === 'BUDGET_REACHED'
          ? 'warning'
          : 'neutral'

  const label = run.stalled ? 'stalled' : run.status.toLowerCase().replace('_', ' ')

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{run.targetUrl}</CardTitle>
            <p className="text-sand-500 text-xs">
              {run.model} · started {formatTime(run.startedAt)} ·{' '}
              {run.decisions === 1 ? '1 decision' : `${run.decisions} decisions`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={tone}>{label}</Badge>
            {live ? (
              <span className="text-sand-500 text-xs" aria-live="polite">
                {polling ? 'refreshing…' : 'live'}
              </span>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Figure label="Held" value={String(run.tally.held)} tone="success" />
          <Figure label="Did not hold" value={String(run.tally.failed)} tone="danger" />
          <Figure label="Console and 5xx" value={String(run.tally.problems)} tone="warning" />
          <Figure
            label="Spent"
            value={`${formatUsdMinor(run.spentMinor)} of ${formatUsdMinor(run.budgetMinor)}`}
            tone="neutral"
          />
        </div>

        <SpendMeter spentMinor={run.spentMinor} budgetMinor={run.budgetMinor} />

        {run.stalled ? (
          <p className="text-sm text-red-800">
            The runner has stopped reporting. It was killed, lost its network, or the machine it
            runs on went to sleep. Nothing is running against the demo.
          </p>
        ) : null}

        {run.stoppedReason ? (
          <p className="text-sand-600 text-sm">{run.stoppedReason}</p>
        ) : null}

        {error ? (
          <ErrorState
            title="The feed could not be read"
            description={error}
            action={
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                Try again
              </Button>
            }
          />
        ) : null}

        {run.status === 'RUNNING' ? (
          <form action={action} className="flex items-center gap-3">
            <input type="hidden" name="runId" value={run.id} />
            <Button type="submit" variant="outline" size="sm" disabled={pending}>
              {pending ? 'Stopping…' : 'Stop the run'}
            </Button>
            {state.message ? (
              <span className="text-sand-600 text-xs">{state.message}</span>
            ) : null}
          </form>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'success' | 'danger' | 'warning' | 'neutral'
}) {
  const colour = {
    success: 'text-emerald-800',
    danger: 'text-red-800',
    warning: 'text-amber-900',
    neutral: 'text-sand-800',
  }[tone]

  return (
    <div className="border-sand-200 rounded-xl border px-3 py-2">
      <p className="text-sand-500 text-xs">{label}</p>
      <p className={`font-display text-lg font-semibold ${colour}`}>{value}</p>
    </div>
  )
}

/**
 * The spend against the ceiling.
 *
 * Not a `<Money>` figure: that component is for the product's money, in minor
 * units of a currency a guest pays, with an `earned` or `potential` intent.
 * This is what the simulation cost to run, in dollars, and dressing it as
 * revenue would be the exact confusion ADR-007 exists to prevent.
 */
function SpendMeter({ spentMinor, budgetMinor }: { spentMinor: number; budgetMinor: number }) {
  const fraction = budgetMinor > 0 ? Math.min(1, spentMinor / budgetMinor) : 0
  const percent = Math.round(fraction * 100)

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label="Spend against the ceiling"
      className="bg-sand-200 h-2 w-full overflow-hidden rounded-full"
    >
      <div
        className={percent >= 90 ? 'h-full bg-red-500' : 'bg-jade-600 h-full'}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

function FeedPanel({
  title,
  icon,
  events,
  emptyTitle,
  emptyHint,
  live,
}: {
  title: string
  icon: React.ReactNode
  events: FeedEvent[]
  emptyTitle: string
  emptyHint: string
  live: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          live ? (
            <div className="space-y-2" aria-label="Waiting for the first event">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-5 w-2/3" />
            </div>
          ) : (
            <EmptyState title={emptyTitle} description={emptyHint} />
          )
        ) : (
          <ol className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
            {[...events].reverse().map((event) => (
              <li key={event.id} className="border-sand-100 border-b pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  <Badge tone={verdictTone(event)}>{event.persona}</Badge>
                  <span className="text-sand-400 text-xs">{formatTime(event.occurredAt)}</span>
                  {event.step ? (
                    <span className="text-sand-500 text-xs">{event.step}</span>
                  ) : null}
                </div>
                <p className="text-sand-800 mt-1 text-sm">{event.summary}</p>
                {event.detail ? (
                  <p className="text-sand-500 mt-0.5 text-xs break-words">{event.detail}</p>
                ) : null}
                {event.path ? (
                  <p className="text-sand-400 font-mono text-[0.7rem]">{event.path}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function GuardPanel({
  events,
  proposals,
  live,
}: {
  events: FeedEvent[]
  proposals: FeedProposal[]
  live: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Lightbulb className="size-4" aria-hidden />
          Harness
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-sand-500 mb-2 text-xs">
            Proposed amendments. Reading one is the whole of what happens to it here — nothing
            writes <code>.claude/</code>, and an accepted proposal becomes a pull request somebody
            opens.
          </p>
          {proposals.length === 0 ? (
            live ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <EmptyState
                title="Nothing proposed"
                description="A proposal appears when something the simulation saw should have been caught by a harness file."
              />
            )
          ) : (
            <ul className="space-y-3">
              {proposals.map((proposal) => (
                <Proposal key={proposal.id} proposal={proposal} />
              ))}
            </ul>
          )}
        </div>

        {events.length > 0 ? (
          <div>
            <p className="text-sand-500 mb-2 flex items-center gap-1.5 text-xs">
              <CircleSlash className="size-3.5" aria-hidden />
              Refused
            </p>
            <ul className="space-y-2">
              {[...events].reverse().map((event) => (
                <li key={event.id} className="rounded-lg bg-amber-50 px-3 py-2">
                  <p className="text-sm text-amber-900">{event.summary}</p>
                  {event.detail ? (
                    <p className="mt-0.5 text-xs text-amber-800">{event.detail}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Proposal({ proposal }: { proposal: FeedProposal }) {
  const [state, action, pending] = useActionState(decideProposalAction, emptyFormState)

  return (
    <li className="border-sand-200 rounded-xl border px-3 py-2">
      <p className="text-sand-800 font-mono text-xs break-all">{proposal.targetPath}</p>
      <p className="text-sand-600 mt-1 text-xs">{proposal.miss}</p>
      <p className="text-sand-800 bg-sand-50 mt-2 rounded-lg px-2 py-1.5 text-xs whitespace-pre-wrap">
        {proposal.suggestion}
      </p>

      {proposal.status === 'PROPOSED' ? (
        <form action={action} className="mt-2 flex items-center gap-2">
          <input type="hidden" name="proposalId" value={proposal.id} />
          <Button type="submit" name="decision" value="ACCEPTED" size="sm" disabled={pending}>
            Take it to a PR
          </Button>
          <Button
            type="submit"
            name="decision"
            value="DISMISSED"
            variant="ghost"
            size="sm"
            disabled={pending}
          >
            Dismiss
          </Button>
        </form>
      ) : (
        <p className="text-sand-500 mt-2 text-xs">{proposal.status.toLowerCase()}</p>
      )}

      {state.message ? <p className="text-sand-500 mt-1 text-xs">{state.message}</p> : null}
    </li>
  )
}

function StartInstructions({ defaultModel }: { defaultModel: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4" aria-hidden />
          Start the runner
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sand-600 max-w-prose text-sm leading-relaxed">
          The personas drive a real browser, which this page cannot host. Run them from a machine
          with the demo URL and the runner token:
        </p>
        <pre className="bg-sand-100 overflow-x-auto rounded-xl px-3 py-2 font-mono text-xs">
{`SIMULATION_BASE_URL=https://arc-stay-demo.vercel.app \\
SIMULATION_TOKEN=… ANTHROPIC_API_KEY=… \\
npm run simulate -- --model=${defaultModel} --budget=5.00`}
        </pre>
        <p className="text-sand-500 max-w-prose text-xs leading-relaxed">
          The runner asks the target what it is before it does anything, and refuses any answer but
          a demo. The budget is a ceiling in dollars; it stops there.
        </p>
      </CardContent>
    </Card>
  )
}

function PreviousRuns({ runs }: { runs: RunRow[] }) {
  if (runs.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Runs</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-sand-100 divide-y text-sm">
          {runs.map((run) => (
            <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sand-700">
                {formatTime(run.startedAt)} · {run.model}
              </span>
              <span className="text-sand-500 text-xs">
                {run.decisions === 1 ? '1 decision' : `${run.decisions} decisions`} ·{' '}
                {run.spent} · {run.failed} did not hold ·{' '}
                {run.status.toLowerCase().replace('_', ' ')}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function verdictTone(event: FeedEvent): 'success' | 'danger' | 'warning' | 'neutral' {
  if (event.verdict === 'HELD') return 'success'
  if (event.verdict === 'FAILED' || event.verdict === 'ERRORED') return 'danger'
  if (event.kind === 'PROBLEM') return 'warning'
  return 'neutral'
}

/**
 * An event's own timestamp, formatted. Not a relative time: "4 seconds ago"
 * needs the current time, and a client component does not get to read it.
 */
function formatTime(iso: string): string {
  const at = new Date(iso)
  return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
