import { NextResponse } from 'next/server'

import { toErrorPayload } from '@/lib/errors'
import { reportError } from '@/lib/observability'
import { authoriseRunner, ingest } from '@/modules/simulation/service'

/**
 * What the runner saw, as it saw it.
 *
 * Batched and append-only. The response is the only thing the runner acts on:
 * `stop` is the spend ceiling's verdict, decided here so that one arbiter
 * holds both the prices and the budget, and `refused` is the list of proposed
 * amendments the harness would not take.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
  try {
    authoriseRunner(request.headers.get('authorization'))
    const body: unknown = await request.json().catch(() => ({}))
    const result = await ingest(body)
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    const { status, body } = toErrorPayload(error)
    if (status >= 500) await reportError(error, { where: 'POST /api/simulation/ingest' })
    return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
  }
}
