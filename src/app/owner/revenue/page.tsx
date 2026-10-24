import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { Money } from '@/components/money'
import { requireActor } from '@/modules/auth/service'
import { resolveOperatingProperty } from '@/modules/hotels/service'
import { getRevenueAnalytics } from '@/modules/analytics/reports'

export const metadata = { title: 'Revenue' }

/**
 * Revenue analytics.
 *
 * Built around the one number the pilot is gated on: incremental
 * destination-commerce contribution per stay, net of supplier payments and
 * refunds. Everything else on this page exists to make that number checkable.
 */
export default async function RevenuePage() {
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)
  const report = await getRevenueAnalytics(actor, propertyId)

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Revenue</h1>
          <p className="text-sand-600 mt-1 text-sm">
            Earned, net of refunds, with the supplier’s and ARC’s share shown separately so the
            arithmetic can be checked by hand.
          </p>
        </div>
        <Badge tone="demo">Simulated</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Contribution per stay — the number the pilot is judged on
          </CardTitle>
          <p className="text-sand-600 text-sm">{report.headline.derivation}</p>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold">
            <Money
              amountMinor={report.headline.perStayMinor}
              currency={report.currency}
              intent="earned"
            />
            <span className="text-sand-500 ml-2 text-base font-normal">per stay</span>
          </p>
          <dl className="text-sand-700 mt-4 grid gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-sand-500 text-xs">Gross sold</dt>
              <dd className="font-medium">
                <Money amountMinor={report.totals.grossMinor} currency={report.currency} />
              </dd>
            </div>
            <div>
              <dt className="text-sand-500 text-xs">Your share</dt>
              <dd className="font-medium">
                <Money amountMinor={report.totals.hotelMinor} currency={report.currency} intent="earned" />
              </dd>
            </div>
            <div>
              <dt className="text-sand-500 text-xs">To partners</dt>
              <dd className="font-medium">
                <Money amountMinor={report.totals.supplierMinor} currency={report.currency} />
              </dd>
            </div>
            <div>
              <dt className="text-sand-500 text-xs">ARC commission</dt>
              <dd className="font-medium">
                <Money amountMinor={report.totals.platformMinor} currency={report.currency} />
              </dd>
            </div>
          </dl>
          <p className="text-sand-600 mt-3 text-sm">
            <Link
              href="/owner/revenue/commission"
              className="text-jade-800 underline underline-offset-4"
            >
              Commission rules
            </Link>{' '}
            decide these shares, and show what a sale would split before a guest books on it.
          </p>
          {report.totals.refundedMinor > 0 ? (
            <p className="text-sand-600 mt-3 text-sm">
              Net of <Money amountMinor={report.totals.refundedMinor} currency={report.currency} />{' '}
              refunded across {report.totals.refundedCount} cancelled lines.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sand-600 text-xs font-medium tracking-wide uppercase">
              Attach rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{report.headline.attachRatePct}%</p>
            <p className="text-sand-500 mt-1 text-xs">
              {report.headline.staysWithOrders} of {report.headline.totalStays} stays bought
              something.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sand-600 text-xs font-medium tracking-wide uppercase">
              Average basket
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              <Money amountMinor={report.headline.averageOrderMinor} currency={report.currency} />
            </p>
            <p className="text-sand-500 mt-1 text-xs">Across {report.totals.orderCount} orders.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sand-600 text-xs font-medium tracking-wide uppercase">
              Effective take rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {report.headline.effectiveTakeRatePct}%
            </p>
            <p className="text-sand-500 mt-1 text-xs">
              Your share of gross, after the blend of per-category splits.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By category</CardTitle>
        </CardHeader>
        <CardContent>
          {report.byCategory.length === 0 ? (
            <EmptyState title="Nothing sold yet" />
          ) : (
            <ul className="divide-sand-200 divide-y text-sm">
              {report.byCategory.map((row) => (
                <li key={row.category} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <p className="font-medium">{row.category}</p>
                    <p className="text-sand-500 text-xs">
                      {row.bookings} bookings · {row.guests} guests
                    </p>
                  </div>
                  <div className="text-right">
                    <Money amountMinor={row.hotelMinor} currency={report.currency} intent="earned" className="font-semibold" />
                    <p className="text-sand-500 text-xs">
                      of <Money amountMinor={row.grossMinor} currency={report.currency} /> gross
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top experiences</CardTitle>
        </CardHeader>
        <CardContent>
          {report.topExperiences.length === 0 ? (
            <EmptyState title="Nothing sold yet" />
          ) : (
            <ul className="divide-sand-200 divide-y text-sm">
              {report.topExperiences.map((row) => (
                <li key={row.experienceId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.title}</p>
                    <p className="text-sand-500 text-xs">
                      {row.supplierName} · {row.bookings} bookings
                    </p>
                  </div>
                  <Money amountMinor={row.hotelMinor} currency={report.currency} intent="earned" />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ledger</CardTitle>
          <p className="text-sand-600 text-sm">
            Every entry written by a simulated checkout or refund. The accounts must sum to gross,
            and this page would show it if they did not.
          </p>
        </CardHeader>
        <CardContent>
          <ul className="divide-sand-200 divide-y text-sm">
            {report.ledger.map((row) => (
              <li key={row.account} className="flex items-center justify-between gap-2 py-2">
                <span className="font-mono text-xs">{row.account}</span>
                <span className="flex items-center gap-3">
                  <span className="text-sand-500 text-xs">{row.entries} entries</span>
                  <Money amountMinor={row.amountMinor} currency={report.currency} />
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-2 py-2 font-semibold">
              <span>Balance</span>
              <Money amountMinor={report.ledgerBalanceMinor} currency={report.currency} />
            </li>
          </ul>
          <p className="text-sand-500 mt-2 text-xs">
            {report.ledgerReconciles
              ? 'The ledger reconciles with the orders it came from.'
              : 'The ledger does not reconcile with its orders. That is a bug, not a rounding quirk.'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
