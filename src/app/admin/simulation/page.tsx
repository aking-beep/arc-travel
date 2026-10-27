import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getEnv } from '@/lib/env'
import { requireActor } from '@/modules/auth/service'
import { assertPlatformAdmin } from '@/modules/tenancy/context'
import {
  DEFAULT_SIMULATION_MODEL,
  estimateHourlyMinor,
  formatUsdMinor,
  SIMULATION_MODEL_IDS,
  TYPICAL_DECISIONS_PER_HOUR,
} from '@/modules/simulation/pricing'
import { listRuns, readFeed } from '@/modules/simulation/service'

import { LiveSimulation } from './live'

export const metadata = { title: 'Live simulation' }
export const dynamic = 'force-dynamic'

/**
 * The live simulation.
 *
 * Simulated people — the six pressure-test personas, improvising rather than
 * replaying a script — work through the demo while this page is open, and
 * every decision, action, verdict and refusal lands here as it happens.
 *
 * The page does not start the runner, and that is deliberate rather than a
 * limitation worth apologising for. The personas drive a real browser, which
 * no serverless function can host, so the runner is a process somebody starts
 * against a demo URL. What this page owns is the other three things: what was
 * seen, what it cost, and when to stop.
 */
export default async function SimulationPage() {
  const actor = await requireActor()
  assertPlatformAdmin(actor)

  const env = getEnv()
  const configured = Boolean(env.SIMULATION_TOKEN)

  const [feed, runs] = await Promise.all([readFeed({}), listRuns(8)])

  /*
   * The hourly estimate, computed on the server from the same price table the
   * runner bills against. A client component must not compute it: it would be
   * the same arithmetic in a second place, and the second place is the one
   * that would drift.
   */
  const hourly = SIMULATION_MODEL_IDS.map((model) => ({
    model,
    perHour: formatUsdMinor(estimateHourlyMinor(model, TYPICAL_DECISIONS_PER_HOUR)),
  }))

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Live simulation</h1>
        <p className="text-sand-600 mt-1 max-w-prose text-sm leading-relaxed">
          Six simulated people working through the demo while you watch. Each one has a goal and a
          set of things that must never happen to it; what it does next is decided a step at a
          time, so the scenarios are new rather than a recording. Everything below is synthetic:
          the runner refuses any target that does not report itself as a demo.
        </p>
      </div>

      <LiveSimulation
        initialFeed={serialise(feed)}
        runs={runs.map((run) => ({
          ...run,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
          spent: formatUsdMinor(run.spentMinor),
        }))}
        configured={configured}
        defaultModel={DEFAULT_SIMULATION_MODEL}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What an hour costs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sand-600 max-w-prose text-sm leading-relaxed">
            Every step a persona takes is one model call, so the bill is the pace multiplied by the
            model. At roughly {TYPICAL_DECISIONS_PER_HOUR} decisions an hour — the pace a real
            browser allows — an hour with the dashboard open costs about:
          </p>
          <ul className="grid gap-2 sm:grid-cols-3">
            {hourly.map((row) => (
              <li
                key={row.model}
                className="border-sand-200 rounded-xl border px-3 py-2 text-sm"
              >
                <span className="text-sand-800 block font-medium">{row.model}</span>
                <span className="text-sand-600">{row.perHour} per hour, estimated</span>
              </li>
            ))}
          </ul>
          <p className="text-sand-500 max-w-prose text-xs leading-relaxed">
            An estimate, from measured token counts and the published prices, with no assumption
            that a prefix was cached. The figure that matters is the spend meter above, which is
            counted from what the API actually reported, and the ceiling is enforced against that.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Dates over the wire as ISO strings: a client component formats, never clocks.
 *
 * Nothing else is pre-formatted here, deliberately. The same panels are later
 * filled by the feed route's JSON, and a field the server page added by hand
 * would simply be missing from every poll after the first — which is how the
 * spend read "undefined of undefined" a minute after the page loaded.
 */
function serialise(feed: Awaited<ReturnType<typeof readFeed>>) {
  return {
    run: feed.run
      ? {
          ...feed.run,
          startedAt: feed.run.startedAt.toISOString(),
          heartbeatAt: feed.run.heartbeatAt.toISOString(),
          finishedAt: feed.run.finishedAt?.toISOString() ?? null,
        }
      : null,
    events: feed.events.map((event) => ({
      ...event,
      occurredAt: event.occurredAt.toISOString(),
    })),
    proposals: feed.proposals.map((proposal) => ({
      ...proposal,
      createdAt: proposal.createdAt.toISOString(),
    })),
    cursor: feed.cursor,
  }
}

export type SerialisedFeed = ReturnType<typeof serialise>
