import { NextResponse } from 'next/server'
import { ZodError } from 'zod'

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
 *
 * The *status* is the runner's other instruction, and the three classes have
 * to be told apart because the runner does different things with them. A
 * malformed batch is the runner's own fault and will be refused identically
 * for ever, so it answers 400 and the runner drops it rather than re-sending
 * it until the budget runs out. `toErrorPayload` does not do that on its own:
 * it maps anything that is not an `AppError` to 500, and a `ZodError` is not
 * one — which made every schema refusal look like a server having a bad
 * minute, which is precisely the thing a client should retry.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
  try {
    authoriseRunner(request.headers.get('authorization'))
    const body: unknown = await request.json().catch(() => ({}))
    const result = await ingest(body)
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'That batch does not fit what a runner may report.',
            details: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
          },
        },
        { status: 400, headers: { 'cache-control': 'no-store' } },
      )
    }

    const { status, body } = toErrorPayload(error)
    if (status >= 500) await reportError(error, { where: 'POST /api/simulation/ingest' })
    return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
  }
}
