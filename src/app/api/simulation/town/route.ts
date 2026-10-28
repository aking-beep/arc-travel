import { NextResponse } from 'next/server'

import { toErrorPayload } from '@/lib/errors'
import { reportError } from '@/lib/observability'
import { getActor } from '@/modules/auth/service'
import { isPlatformAdmin } from '@/modules/tenancy/context'
import {
  MAX_SIMULATED_STAYS,
  recentActivity,
  simulatedPopulation,
} from '@/modules/simulation/inhabitants'

/**
 * What the inhabitants have been doing.
 *
 * A platform admin session, as the persona feed is. The activity log names
 * simulated guests, and a demo visitor seeing which of the people in the
 * arrivals list were invented is a different product than the one being shown.
 *
 * Read-only: nothing here ticks the town. The clocks are the scheduled job and
 * the heartbeat, so opening this panel does not quietly become a third one.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const actor = await getActor()
    if (!actor || !isPlatformAdmin(actor)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 30)
    const [population, activity] = await Promise.all([
      simulatedPopulation(),
      recentActivity(Number.isFinite(limit) ? limit : 30),
    ])

    return NextResponse.json(
      { population, cap: MAX_SIMULATED_STAYS, activity },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    const { status, body } = toErrorPayload(error)
    if (status >= 500) await reportError(error, { where: 'GET /api/simulation/town' })
    return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
  }
}
