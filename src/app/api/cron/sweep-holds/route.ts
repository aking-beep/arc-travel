import { NextResponse } from 'next/server'
import { cronGate } from '@/lib/cron-request'
import { reportError } from '@/lib/observability'
import { sweepExpiredHolds } from '@/modules/inventory/service'

/**
 * The scheduled hold sweep.
 *
 * Holds already expire lazily: every read path that touches a slot sweeps it
 * first, because an expiry that only happens when a cron job runs is an expiry
 * that does not happen. That covers every hold anybody looks at again, and
 * nothing else — a guest who abandons a basket on a departure nobody opens
 * again leaves `held` standing for ever, and `placeHold` then refuses places
 * that are free. Lazy sweeping is correct and incomplete; this is the rest.
 *
 * It is a route rather than a worker because the deployment target has no
 * long-running process to put a timer in. `vercel.json` schedules it every
 * fifteen minutes, which is `HOLD_TTL_MINUTES`.
 *
 * Authorisation is a shared secret in the `Authorization` header, compared in
 * constant time. Not public even though it only releases expired holds: it
 * writes, and an endpoint that writes and anyone can call is a load generator.
 */
export const dynamic = 'force-dynamic'

/** Holds released per transaction. One sweep is one Serializable transaction. */
const BATCH = 200

/** Batches per invocation, so a neglected database converges over several runs. */
const MAX_BATCHES = 10

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
  const refusal = cronGate(request)
  if (refusal) return refusal

  try {
    let swept = 0
    let batches = 0
    for (; batches < MAX_BATCHES; batches += 1) {
      const released = await sweepExpiredHolds({ limit: BATCH })
      swept += released
      // A short batch means the backlog is gone; stop rather than spin.
      if (released < BATCH) break
    }

    // Logged, not reported: a sweep that found nothing is the normal case and
    // the number is the only thing worth having in a log.
    console.log('[sweep-holds] released %d hold(s) in %d batch(es).', swept, batches + 1)
    return NextResponse.json({ swept, batches: batches + 1 })
  } catch (error) {
    await reportError(error, { where: '/api/cron/sweep-holds' })
    // 500 so the scheduler's own retry and alerting see the failure. A sweep
    // is idempotent, so being run again is always safe.
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}

