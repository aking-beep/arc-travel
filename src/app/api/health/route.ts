import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getEnv } from '@/lib/env'

/**
 * The liveness probe, for an uptime checker.
 *
 * ## Why this exists alongside `/admin/health`
 *
 * `/admin/health` is the rich page, and it requires a signed-in platform admin
 * — so it cannot be polled, which meant the build had no uptime monitoring at
 * all. Anything that could watch it would need an admin session, and handing a
 * monitoring service one is worse than not monitoring.
 *
 * So this is the other half: unauthenticated, and therefore it says almost
 * nothing. Status, whether the database answers, and the time. No version, no
 * provider names, no counts, no configuration — an unauthenticated endpoint is
 * reconnaissance for anyone who finds it, and "the database is down" is the
 * most an anonymous caller gets.
 *
 * With `MONITORING_TOKEN` configured and presented, it returns the detail a
 * checker can usefully alert on. Unset means the detailed form is simply
 * unavailable, never that it is open: same rule as `CRON_SECRET`.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  const started = Date.now()

  /*
   * One trivial query. Not a count, not a health table: `SELECT 1` proves the
   * pool can get a connection and the server answers, which is the whole
   * question. A query that touches application tables would make this endpoint
   * a way to time them.
   */
  let database = false
  try {
    await prisma.$queryRaw`SELECT 1`
    database = true
  } catch {
    database = false
  }

  const latencyMs = Date.now() - started
  const status = database ? 'ok' : 'degraded'

  if (!authorised(request)) {
    /*
     * The anonymous answer. Deliberately uninformative, and still useful: a
     * checker alerting on a non-200 or on `status != "ok"` has what it needs.
     */
    return NextResponse.json(
      { status, time: new Date().toISOString() },
      { status: database ? 200 : 503, headers: { 'cache-control': 'no-store' } },
    )
  }

  const env = getEnv()

  return NextResponse.json(
    {
      status,
      time: new Date().toISOString(),
      checks: { database, latencyMs },
      /*
       * Configuration that changes what the deployment *is*, which is what a
       * checker should alert on a change to: a demo that quietly became a live
       * payment deployment, or the reverse, is worth knowing about. Still no
       * secrets, no keys, no hostnames.
       */
      mode: env.ARC_DATA_MODE,
      payments: env.PAYMENTS_PROVIDER,
      ai: env.AI_PROVIDER,
      outboundMessaging: env.ARC_ENABLE_OUTBOUND_MESSAGING,
      demoDoor:
        (process.env.ARC_DEMO_PASSPHRASE ?? '').length > 0
          ? 'passphrase'
          : env.ARC_ALLOW_OPEN_DEMO
            ? 'open-by-choice'
            : 'open',
    },
    { status: database ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  )
}

/**
 * Constant-time comparison of a bearer token.
 *
 * Not `node:crypto`'s `timingSafeEqual` via a length check and back, because
 * this file is small and the shape is the same as `sweep-holds`: compare only
 * when the lengths match, and compare every byte when they do.
 */
function authorised(request: Request): boolean {
  const configured = process.env.MONITORING_TOKEN
  if (!configured || configured.length === 0) return false

  const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer /i, '')
  if (presented.length !== configured.length) return false

  let diff = 0
  for (let i = 0; i < configured.length; i += 1) {
    diff |= presented.charCodeAt(i) ^ configured.charCodeAt(i)
  }
  return diff === 0
}
