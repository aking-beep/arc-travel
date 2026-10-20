import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { Money } from '@/components/money'
import { requireActor } from '@/modules/auth/service'
import { listSupplierBookings, resolveOperatingSupplier } from '@/modules/suppliers/service'
import { toDateKey, toLocalTimeString } from '@/lib/dates'
import { ConfirmBookingForm } from '../forms'

export const metadata = { title: 'Bookings' }

export default async function BookingsPage() {
  const actor = await requireActor()
  const { supplierId } = await resolveOperatingSupplier(actor)
  const bookings = await listSupplierBookings(actor, supplierId)

  const unconfirmed = bookings.filter((b) => !b.supplierConfirmedAt)
  const confirmed = bookings.filter((b) => b.supplierConfirmedAt)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Booking requests</h1>
        <p className="text-sand-600 mt-1 text-sm">
          You confirm each one by hand. ARC does not auto-confirm on your behalf, and nothing is
          paid out in this build.
        </p>
      </div>

      {bookings.length === 0 ? (
        <EmptyState
          title="No upcoming bookings"
          description="Guests book through the hotel’s portal. Add availability and they will appear here."
        />
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="font-display text-base font-semibold">
              Needs your confirmation ({unconfirmed.length})
            </h2>
            {unconfirmed.length === 0 ? (
              <p className="text-sand-600 text-sm">Nothing outstanding.</p>
            ) : (
              unconfirmed.map((booking) => (
                <Card key={booking.id}>
                  <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="font-medium">{booking.experience.titleEn}</p>
                      <p className="text-sand-600 text-sm tabular-nums">
                        {toDateKey(booking.slot.startsAt)} ·{' '}
                        {toLocalTimeString(booking.slot.startsAt)}–
                        {toLocalTimeString(booking.slot.endsAt)}
                      </p>
                      <p className="text-sand-500 mt-1 text-xs">
                        {booking.order.guest?.firstName ?? 'Guest'} · {booking.quantity}{' '}
                        {booking.quantity === 1 ? 'person' : 'people'} · {booking.order.reference}
                      </p>
                      {booking.participantNotes ? (
                        <p className="bg-sand-100 text-sand-700 mt-2 rounded-lg px-3 py-1.5 text-xs">
                          {booking.participantNotes}
                        </p>
                      ) : null}
                      {booking.experience.meetingPoint ? (
                        <p className="text-sand-500 mt-1 text-xs">
                          Meeting at {booking.experience.meetingPoint}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <Money
                        amountMinor={booking.supplierPayableMinor}
                        currency={booking.currency}
                        className="font-semibold"
                      />
                      <span className="text-sand-400 text-[0.6875rem]">your share, simulated</span>
                      <ConfirmBookingForm orderItemId={booking.id} />
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </section>

          {confirmed.length > 0 ? (
            <section className="space-y-3">
              <h2 className="font-display text-base font-semibold">
                Confirmed ({confirmed.length})
              </h2>
              <ul className="divide-sand-200 divide-y text-sm">
                {confirmed.map((booking) => (
                  <li key={booking.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="font-medium">{booking.experience.titleEn}</p>
                      <p className="text-sand-500 text-xs tabular-nums">
                        {toDateKey(booking.slot.startsAt)} {toLocalTimeString(booking.slot.startsAt)}{' '}
                        · {booking.order.guest?.firstName ?? 'Guest'} ×{booking.quantity}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Money
                        amountMinor={booking.supplierPayableMinor}
                        currency={booking.currency}
                      />
                      <Badge tone="success">Confirmed</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}
