import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getEnv } from '@/lib/env'
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

export async function POST(request: Request): Promise<NextResponse> {
  const env = getEnv()

  if (env.ARC_DATA_MODE !== 'demo') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Unconfigured means off, not open — as in the other scheduled routes.
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!authorised(request.headers.get('authorization'), env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await tick({ source: 'cron', actions: 3 })
    return NextResponse.json({
      actions: result.actions.map((action) => action.summary),
      population: result.population,
    })
  } catch (error) {
    await reportError(error, { where: 'POST /api/cron/inhabitants' })
    return NextResponse.json({ error: 'Tick failed' }, { status: 500 })
  }
}

function authorised(header: string | null, secret: string): boolean {
  if (!header) return false
  const presented = Buffer.from(header.replace(/^Bearer /i, ''), 'utf8')
  const expected = Buffer.from(secret, 'utf8')
  if (presented.length !== expected.length) return false
  return timingSafeEqual(presented, expected)
}
