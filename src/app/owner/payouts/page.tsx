import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { Money } from '@/components/money'
import { DemoFigure } from '@/components/money'
import { isDemoMode } from '@/lib/env'
import { toDateKey } from '@/lib/dates'
import { PayoutStatus } from '@/lib/prisma-types'
import { requireActor } from '@/modules/auth/service'
import { resolveOperatingProperty } from '@/modules/hotels/service'
import { listPayouts, monthToDate, summarisePayables } from '@/modules/commerce/payouts'
import { RunPayoutsForm } from './forms'

export const metadata = { title: 'Partner payouts' }

const STATUS_TONE = {
  [PayoutStatus.DRAFT]: 'warning',
  [PayoutStatus.APPROVED]: 'brand',
  [PayoutStatus.SETTLED]: 'success',
  [PayoutStatus.CANCELLED]: 'neutral',
} as const

const STATUS_LABEL = {
  [PayoutStatus.DRAFT]: 'Awaiting your approval',
  [PayoutStatus.APPROVED]: 'Approved — not yet paid',
  [PayoutStatus.SETTLED]: 'Paid',
  [PayoutStatus.CANCELLED]: 'Cancelled',
} as const

export default async function PayoutsPage() {
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)

  // Server-computed, because a client component must not read the clock.
  const period = monthToDate()

  const [payables, payouts] = await Promise.all([
    summarisePayables(actor, { propertyId, ...period }),
    listPayouts(actor, { propertyId }),
  ])

  const demo = isDemoMode()
  const openNet = payables.reduce((sum, row) => sum + Math.max(row.netMinor, 0), 0)
  const withheldNet = payables.reduce(
    (sum, row) => sum + row.withheld.reduce((n, item) => n + item.amountMinor, 0),
    0,
  )
  const currency = payables[0]?.currency ?? 'MXN'

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Partner payouts</h1>
        <p className="text-sand-600 mt-1 text-sm leading-relaxed">
          What each partner is owed, worked out from the ledger rather than recomputed — so this
          page and a partner’s own earnings page cannot disagree.{' '}
          <strong className="font-medium">ARC does not send the money.</strong> It works out the
          amount, records that you authorised it, and keeps the reference of the payment you made.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Open since {period.from}</CardTitle>
          <p className="text-sand-600 text-sm">
            Everything not yet on a payout. Approving one claims its ledger entries, so a second
            run cannot pay the same booking twice.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sand-500 text-xs tracking-wide uppercase">Payable now</p>
              <p className="mt-1 text-2xl font-semibold">
                {demo ? (
                  <DemoFigure>
                    <Money amountMinor={openNet} currency={currency} intent="neutral" />
                  </DemoFigure>
                ) : (
                  <Money amountMinor={openNet} currency={currency} intent="neutral" />
                )}
              </p>
              <p className="text-sand-500 mt-1 text-xs">
                Across {payables.filter((row) => row.lines.length > 0).length} partners.
              </p>
            </div>
            <div>
              <p className="text-sand-500 text-xs tracking-wide uppercase">Held back</p>
              <p className="mt-1 text-2xl font-semibold">
                <Money amountMinor={withheldNet} currency={currency} intent="neutral" />
              </p>
              <p className="text-sand-500 mt-1 text-xs">
                Not lost — waiting on a confirmation, a cancellation, or a disputed payment.
              </p>
            </div>
          </div>

          {payables.length === 0 ? (
            <EmptyState
              title="Nothing owed in this period"
              description="Confirmed bookings appear here as partners confirm them."
            />
          ) : (
            <ul className="divide-sand-200 divide-y text-sm">
              {payables.map((row) => (
                <li key={row.supplierId} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{row.supplierName}</p>
                      <p className="text-sand-500 text-xs">
                        {row.lines.length} {row.lines.length === 1 ? 'line' : 'lines'} payable
                        {row.withheld.length > 0 ? ` · ${row.withheld.length} held back` : ''}
                      </p>
                    </div>
                    <Money
                      amountMinor={row.netMinor}
                      currency={row.currency}
                      intent="neutral"
                      className="font-semibold"
                    />
                  </div>

                  {row.withheld.length > 0 ? (
                    <details className="border-sand-200 rounded-xl border px-3.5 py-2.5">
                      <summary className="text-sand-700 cursor-pointer text-xs font-medium">
                        Why{' '}
                        <Money
                          amountMinor={row.withheld.reduce((n, item) => n + item.amountMinor, 0)}
                          currency={row.currency}
                          intent="neutral"
                        />{' '}
                        is being held back
                      </summary>
                      {/*
                        * Itemised rather than summarised. "We owe you 40,000
                        * and are paying 31,000" needs the other 9,000
                        * accounted for, or the partner assumes it is lost.
                        */}
                      <ul className="text-sand-600 mt-2 space-y-1 text-xs">
                        {row.withheld.map((item) => (
                          <li key={item.ledgerEntryId} className="flex justify-between gap-3">
                            <span>{item.reason}</span>
                            <Money
                              amountMinor={item.amountMinor}
                              currency={row.currency}
                              intent="neutral"
                            />
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compute a payout run</CardTitle>
          <p className="text-sand-600 text-sm">
            Each partner with a positive balance gets a payout and an approval. A partner whose
            refunds exceed their sales gets neither — that balance carries into the next run rather
            than being written off.
          </p>
        </CardHeader>
        <CardContent>
          <RunPayoutsForm from={period.from} to={period.to} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payout history</CardTitle>
        </CardHeader>
        <CardContent>
          {payouts.length === 0 ? (
            <EmptyState
              title="No payouts yet"
              description="Compute a run above and it will appear here, waiting for your approval."
            />
          ) : (
            <ul className="divide-sand-200 divide-y text-sm">
              {payouts.map((payout) => (
                <li key={payout.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      <Link
                        href={`/owner/payouts/${payout.id}`}
                        className="text-jade-800 underline underline-offset-4"
                      >
                        {payout.reference}
                      </Link>{' '}
                      <span className="text-sand-600 font-normal">{payout.supplier.name}</span>
                    </p>
                    <p className="text-sand-500 text-xs tabular-nums">
                      {toDateKey(payout.periodStart)} → {toDateKey(payout.periodEnd)} ·{' '}
                      {payout._count.lines} {payout._count.lines === 1 ? 'line' : 'lines'}
                      {payout.settledAt ? ` · paid ${toDateKey(payout.settledAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Money
                      amountMinor={payout.netMinor}
                      currency={payout.currency}
                      intent="neutral"
                      className="font-semibold"
                    />
                    <Badge tone={STATUS_TONE[payout.status]}>{STATUS_LABEL[payout.status]}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
