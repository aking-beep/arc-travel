import { NextResponse } from 'next/server'
import { getEnv } from '@/lib/env'
import { isAppError } from '@/lib/errors'
import { reportError } from '@/lib/observability'
import { consumeRateLimit } from '@/lib/rate-limit'
import { tick } from '@/modules/simulation/inhabitants'

/**
 * The heartbeat.
 *
 * Somebody with the demo open is the one person who notices that nothing is
 * happening, so an open page nudges the town along: `DemoPulse` calls this
 * while a tab is visible and stops when it is not.
 *
 * It takes no credential, because every surface of the demo is meant to be
 * opened by whoever has been sent the link, and a tick does nothing a demo
 * visitor could not do by hand. What stops it being a load generator is a
 * *global* budget rather than a per-caller one: a bucket with no subject in
 * it, so twenty open tabs and one open tab produce the same town. That is the
 * same reason it is not per-IP — twenty tabs in one room would each get their
 * own allowance.
 *
 * A refused tick is a 200 with `ticked: false`. The caller is a heartbeat, and
 * an error it is supposed to ignore does not belong in a browser console.
 */
export const dynamic = 'force-dynamic'

/** Ticks the whole deployment may run in a minute, whoever is watching. */
const TICKS_PER_MINUTE = 6

export async function POST(): Promise<NextResponse> {
  const env = getEnv()

  if (env.ARC_DATA_MODE !== 'demo') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const budget = await consumeRateLimit({
      bucket: 'simulation.heartbeat',
      limit: TICKS_PER_MINUTE,
      windowSeconds: 60,
    })
    if (!budget.allowed) {
      return NextResponse.json({ ticked: false, reason: 'budget', resetAt: budget.resetAt })
    }

    const result = await tick({ source: 'heartbeat', actions: 1 })
    return NextResponse.json({
      ticked: true,
      actions: result.actions.map((action) => action.summary),
      population: result.population,
    })
  } catch (error) {
    // A domain refusal is the product working and the heartbeat's own tick
    // already records one as an activity; anything else is a bug worth seeing.
    if (!isAppError(error)) {
      await reportError(error, { where: 'POST /api/simulation/tick' })
    }
    return NextResponse.json({ ticked: false, reason: 'refused' })
  }
}
