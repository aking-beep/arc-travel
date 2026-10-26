import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getEnv } from '@/lib/env'
import { reportError } from '@/lib/observability'
import { dispatchQueued } from '@/modules/notifications/service'

/**
 * The scheduled mail dispatcher.
 *
 * Every sender already dispatches its own message the moment its transaction
 * commits, so in the ordinary case this route finds nothing. It exists for the
 * cases where that does not happen, and all of them matter:
 *
 *   - the process died between the commit and the send. The invitation exists
 *     and the partner has not heard about it.
 *   - the provider was down, or rate-limited us. The row is queued with its
 *     reason and its attempt count.
 *   - `ARC_ENABLE_TRANSACTIONAL_EMAIL` was off when the message was written and
 *     has since been turned on. The backlog goes out, which is what makes
 *     "configure mail later" a real option rather than a lost first week.
 *
 * Same authorisation as the other cron routes: a shared secret compared in
 * constant time, and an unset secret means 404 rather than open. See ADR-037.
 */
export const dynamic = 'force-dynamic'

/** Messages per invocation. Bounded so one run cannot exceed the function's budget. */
const LIMIT = 50

export async function POST(request: Request): Promise<NextResponse> {
  const env = getEnv()

  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!authorised(request.headers.get('authorization'), env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const outcome = await dispatchQueued({ limit: LIMIT })
    console.log(
      '[dispatch-email] sent=%d logged=%d failed=%d deferred=%d',
      outcome.sent,
      outcome.logged,
      outcome.failed,
      outcome.deferred,
    )
    /*
     * 200 even when messages failed, for the ADR-037 reason: the dispatcher
     * ran and worked. A failed message is a fact about an address or a
     * provider, and a 500 here would re-alert every five minutes about
     * something no retry of this route will fix, hiding a genuine failure of
     * the route itself.
     */
    return NextResponse.json(outcome)
  } catch (error) {
    await reportError(error, { where: 'POST /api/cron/dispatch-email' })
    return NextResponse.json({ error: 'Dispatch failed' }, { status: 500 })
  }
}

function authorised(header: string | null, secret: string): boolean {
  if (!header) return false
  const presented = Buffer.from(header.replace(/^Bearer /i, ''), 'utf8')
  const expected = Buffer.from(secret, 'utf8')
  if (presented.length !== expected.length) return false
  return timingSafeEqual(presented, expected)
}
