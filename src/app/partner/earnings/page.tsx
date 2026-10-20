import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { Money } from '@/components/money'
import { requireActor } from '@/modules/auth/service'
import { getSupplierEarnings, resolveOperatingSupplier } from '@/modules/suppliers/service'

export const metadata = { title: 'Earnings' }

export default async function EarningsPage() {
  const actor = await requireActor()
  const { supplierId } = await resolveOperatingSupplier(actor)
  const earnings = await getSupplierEarnings(actor, supplierId)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Earnings</h1>
          <p className="text-sand-600 mt-1 text-sm">
            What you would be owed on confirmed bookings, after the hotel’s share and ARC’s
            commission.
          </p>
        </div>
        <Badge tone="demo">Demo data</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sand-600 text-xs font-medium tracking-wide uppercase">
              Payable
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              <Money amountMinor={earnings.payableMinor} currency={earnings.currency} intent="earned" />
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sand-600 text-xs font-medium tracking-wide uppercase">
              Bookings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{earnings.bookingCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sand-600 text-xs font-medium tracking-wide uppercase">
              Guests served
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{earnings.guestsServed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sand-600 text-xs font-medium tracking-wide uppercase">
              Refunded
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              <Money amountMinor={earnings.refundedMinor} currency={earnings.currency} />
            </p>
            <p className="text-sand-500 mt-1 text-xs">{earnings.refundedCount} cancellations</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By experience</CardTitle>
        </CardHeader>
        <CardContent>
          {earnings.byExperience.length === 0 ? (
            <EmptyState title="Nothing booked yet" />
          ) : (
            <ul className="divide-sand-200 divide-y text-sm">
              {earnings.byExperience.map((row) => (
                <li key={row.experienceId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium">{row.title}</p>
                    <p className="text-sand-500 text-xs">
                      {row.bookings} bookings · {row.guests} guests
                    </p>
                  </div>
                  <Money amountMinor={row.payableMinor} currency={earnings.currency} className="font-semibold" />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-sand-500 text-xs leading-relaxed">
        Payouts are disabled for every partner in this build. These figures record what would be
        owed on simulated orders; no money has moved and no payment method is on file.
        {earnings.awaitingConfirmation > 0
          ? ` ${earnings.awaitingConfirmation} bookings are still waiting on your confirmation.`
          : ''}
      </p>
    </div>
  )
}
