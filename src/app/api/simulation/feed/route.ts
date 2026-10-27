import { NextResponse } from 'next/server'

import { toErrorPayload } from '@/lib/errors'
import { reportError } from '@/lib/observability'
import { getActor } from '@/modules/auth/service'
import { isPlatformAdmin } from '@/modules/tenancy/context'
import { readFeed } from '@/modules/simulation/service'

/**
 * The dashboard's feed.
 *
 * A platform admin session, the same predicate the admin layout redirects on —
 * never the runner's token. The two directions are different permissions: the
 * runner may write what it saw and may not read the feed back, and an operator
 * may read everything and may not write a line of it.
 *
 * Polled with a cursor rather than streamed. The deployment target runs this as
 * a serverless function with a duration ceiling, so a held-open event stream
 * dies and reconnects on a timer; a panel that blinks is worse than a panel
 * that refreshes. See ADR-043.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const actor = await getActor()
    if (!actor || !isPlatformAdmin(actor)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const url = new URL(request.url)
    const feed = await readFeed({
      runId: url.searchParams.get('runId') ?? undefined,
      afterSequence: url.searchParams.get('after') ?? 0,
      limit: url.searchParams.get('limit') ?? 200,
    })

    return NextResponse.json(feed, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    const { status, body } = toErrorPayload(error)
    if (status >= 500) await reportError(error, { where: 'GET /api/simulation/feed' })
    return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
  }
}
