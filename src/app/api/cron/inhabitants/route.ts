import { NextResponse } from 'next/server'
import { cronGate } from '@/lib/cron-request'
import { isDemoMode } from '@/lib/env'
import { reportError } from '@/lib/observability'
import { tick } from '@/modules/simulation/inhabitants'

/**
 * The town's baseline clock.
 *
 * The demo has to be inhabited whether or not anybody is looking at it: an
 * owner who opens the briefing at nine wants a morning behind them, not a
 * marketplace that started when their browser did. `vercel.json` runs this
 * every five minutes, which is a few dozen things an hour — a small town, not
 * a stampede.
 *
 * The heartbeat in `/api/simulation/tick` is the other clock, and it is the
 * one that makes a page being watched feel alive. This one is why there is
 * something to watch.
 *
 * Demo only, twice: `tick` refuses outside `ARC_DATA_MODE=demo` and this
 * returns 404 there rather than letting a scheduled job on a pilot deployment
 * discover the refusal every five minutes.
 */
export const dynamic = 'force-dynamic'

/**
 * Both verbs, deliberately: Vercel's scheduler sends a `GET`, and a route that
 * exported `POST` alone was a job that never ran. See `src/lib/cron-request.ts`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return run(request)
}

export async function POST(request: Request): Promise<NextResponse> {
  return run(request)
}

async function run(request: Request): Promise<NextResponse> {
  // Ahead of the credential, because this is the stronger refusal: ADR-044's
  // first of three, and it must hold even on a deployment whose secret is right.
  if (!isDemoMode()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const refusal = cronGate(request)
  if (refusal) return refusal

  try {
    const result = await tick({ source: 'cron', actions: 3 })
    /*
     * Logged even when the roll came up empty, like the other three routes.
     *
     * This route printed nothing on a successful tick, and a run that does
     * nothing is a legitimate outcome here — the weights decline more often
     * than they act. So "ran and the town was quiet" and "was never invoked
     * at all" produced exactly the same evidence: none. That ambiguity is
     * what let the POST-only bug sit for a month (`src/lib/cron-request.ts`),
     * and it is what made the fix hard to confirm afterwards.
     */
    console.log(
      '[inhabitants] %d action(s): %s',
      result.actions.length,
      result.actions.map((action) => action.kind).join(', ') || 'none',
    )
    return NextResponse.json({
      actions: result.actions.map((action) => action.summary),
      population: result.population,
    })
  } catch (error) {
    await reportError(error, { where: '/api/cron/inhabitants' })
    return NextResponse.json({ error: 'Tick failed' }, { status: 500 })
  }
}

