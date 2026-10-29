import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getEnv } from '@/lib/env'

/**
 * The gate every scheduled route starts with.
 *
 * ## Why this is one function and not four
 *
 * It was four: each cron route carried its own copy of the same bearer
 * comparison. They agreed, which is the only reason nothing had gone wrong
 * yet — ADR-029 is the same story about the operating-window check, where
 * three copies stopped agreeing. One copy also gives the rule below one place
 * to be written down.
 *
 * ## The rule that cost a month of scheduled work
 *
 * **Vercel invokes a cron job with a `GET`.** Every one of these routes
 * exported `POST` alone, so every scheduled invocation met a route with no
 * handler for the method, and not one of the four jobs had ever run: expired
 * holds were never swept, the invariant check never reported, queued mail was
 * never dispatched, and the demo's population never moved on its own clock.
 * The symptom was silence, which is exactly what a healthy scheduled job also
 * looks like.
 *
 * So a scheduled route exports **both**. `GET` is the one the scheduler uses;
 * `POST` stays because it is the honest verb for a route that writes, it is
 * what the operator runbook and the pressure-test personas call, and removing
 * it would break them to no purpose. `tests/unit/cron-routes.test.ts` fails if
 * a path in `vercel.json` has no `GET`.
 *
 * ## The refusals
 *
 * Returns the response to send, or `null` when the caller may proceed.
 *
 * An unset `CRON_SECRET` is 404, not open: treating a missing variable as "no
 * authorisation required" is how an internal endpoint becomes a public one on
 * the one deployment where somebody forgot to set it. A wrong secret is 401,
 * compared in constant time.
 */
export function cronGate(request: Request): NextResponse | null {
  const env = getEnv()

  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!authorised(request.headers.get('authorization'), env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}

function authorised(header: string | null, secret: string): boolean {
  if (!header) return false
  const presented = Buffer.from(header.replace(/^Bearer /i, ''), 'utf8')
  const expected = Buffer.from(secret, 'utf8')
  // Lengths differ is itself the answer, and `timingSafeEqual` throws on a
  // length mismatch rather than returning false.
  if (presented.length !== expected.length) return false
  return timingSafeEqual(presented, expected)
}
