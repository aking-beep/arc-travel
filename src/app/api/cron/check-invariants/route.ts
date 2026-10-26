import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getEnv } from '@/lib/env'
import { reportError } from '@/lib/observability'
import { checkInvariants, hasCritical } from '@/modules/observability/invariants'

/**
 * The scheduled invariant check.
 *
 * Error reporting sees requests that threw. These findings never throw: an
 * oversold slot, a split that does not reconcile, a payout that does not equal
 * its lines, a partner whose insurance expired. Nothing 500s, no guest
 * notices, and the first symptom is a partner asking why their payout is short.
 * See `src/modules/observability/invariants.ts`.
 *
 * Authorised with `CRON_SECRET`, the same way as the hold sweep, even though
 * this route only reads: the queries are a dozen aggregates over the whole
 * database, which makes an unauthenticated version a load generator.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
  const env = getEnv()

  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!authorised(request.headers.get('authorization'), env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const report = await checkInvariants()

    if (report.healthy) {
      console.log('[check-invariants] %d checks, nothing to report.', report.checksRun)
      return NextResponse.json({ healthy: true, checksRun: report.checksRun, findings: [] })
    }

    /*
     * Logged first, every time, whatever happens with the reporter.
     *
     * A finding that exists only in Sentry is a finding that vanishes when the
     * DSN is unset — which is the default — and these are the findings least
     * likely to be noticed any other way.
     */
    for (const finding of report.findings) {
      console.error(
        '[check-invariants] %s %s: %s (sample: %s)',
        finding.severity.toUpperCase(),
        finding.key,
        finding.summary,
        finding.sample.join(', '),
      )
    }

    /*
     * A critical finding is reported as a fault so it reaches whatever is
     * watching faults, rather than needing a second alerting integration
     * nobody has configured. Warnings stay in the log: they are a queue to work
     * through, not something to wake a person for, and paging on them trains
     * whoever is on call to ignore the channel (`docs/operations.md`).
     */
    if (hasCritical(report)) {
      const critical = report.findings.filter((f) => f.severity === 'critical')
      await reportError(
        new Error(
          `Invariant violation: ${critical.map((f) => `${f.key} (${String(f.count)})`).join(', ')}`,
        ),
        {
          where: 'POST /api/cron/check-invariants',
          extra: {
            // Keys and counts, not rows. The summaries carry no guest data,
            // but the rule is to send field names rather than content.
            findings: critical.map((f) => f.key).join(','),
            affected: critical.reduce((n, f) => n + f.count, 0),
          },
        },
      )
    }

    /*
     * 200, not 500. The check ran and did its job; the database is what is
     * unhealthy. Returning 500 would make the scheduler retry — producing the
     * same finding and the same alert every few minutes — and would make a
     * monitoring failure indistinguishable from a finding.
     */
    return NextResponse.json({
      healthy: false,
      checksRun: report.checksRun,
      findings: report.findings,
    })
  } catch (error) {
    // This branch *is* a monitoring failure: the queries themselves broke.
    await reportError(error, { where: 'POST /api/cron/check-invariants' })
    return NextResponse.json({ error: 'Invariant check failed' }, { status: 500 })
  }
}

function authorised(header: string | null, secret: string): boolean {
  if (!header) return false
  const presented = Buffer.from(header.replace(/^Bearer /i, ''), 'utf8')
  const expected = Buffer.from(secret, 'utf8')
  if (presented.length !== expected.length) return false
  return timingSafeEqual(presented, expected)
}
