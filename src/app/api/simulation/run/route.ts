import { NextResponse } from 'next/server'

import { getEnv } from '@/lib/env'
import { toErrorPayload } from '@/lib/errors'
import { reportError } from '@/lib/observability'
import { authoriseRunner, startRun } from '@/modules/simulation/service'

/**
 * The runner's handshake.
 *
 * `GET` is the preflight: the runner asks the target what it is before it
 * starts inventing guests on it, and only ever runs against an answer of
 * `demo`. The check is here rather than in the runner's own configuration on
 * purpose — a base URL in a shell variable is a claim about which deployment
 * somebody meant, and the deployment's own answer is the fact. See ADR-043.
 *
 * `POST` opens a run. Both need the runner's bearer token, and an unset
 * `SIMULATION_TOKEN` 404s rather than admitting an anonymous caller: the same
 * rule as `CRON_SECRET`, and the rows this writes are read back by an operator
 * as evidence of what the product did.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  try {
    authoriseRunner(request.headers.get('authorization'))
    const env = getEnv()
    return NextResponse.json(
      {
        ready: true,
        /** What this deployment says it is. The runner refuses anything else. */
        dataMode: env.ARC_DATA_MODE,
        payments: env.PAYMENTS_PROVIDER,
        outboundMessaging: env.ARC_ENABLE_OUTBOUND_MESSAGING,
      },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    return respondToError(error, 'GET /api/simulation/run')
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    authoriseRunner(request.headers.get('authorization'))
    const body: unknown = await request.json().catch(() => ({}))
    const run = await startRun(body)
    return NextResponse.json(run, { status: 201, headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return respondToError(error, 'POST /api/simulation/run')
  }
}

async function respondToError(error: unknown, where: string): Promise<NextResponse> {
  const { status, body } = toErrorPayload(error)
  if (status >= 500) await reportError(error, { where })
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
}
