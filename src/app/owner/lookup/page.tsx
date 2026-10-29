import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { Money } from '@/components/money'
import { requireActor } from '@/modules/auth/service'
import { lookupReference, resolveOperatingProperty } from '@/modules/hotels/service'
import { isAppError } from '@/lib/errors'
import { toDateKey, toLocalTimeString } from '@/lib/dates'

export const metadata = { title: 'Find a booking' }

/**
 * The answer to "my reference is ARC-X3M8-DN7N".
 *
 * A GET form rather than a server action: a lookup changes nothing, and the
 * result wants to be a URL the desk can keep open, reload and send to a
 * colleague.
 */
export default async function LookupPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>
}) {
  const { ref } = await searchParams
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)

  let result: Awaited<ReturnType<typeof lookupReference>> | null = null
  let error: string | null = null
  if (ref !== undefined && ref.trim() !== '') {
    try {
      result = await lookupReference(actor, propertyId, { reference: ref })
    } catch (caught) {
      // A reference too short to search for is the guest having read out half
      // of it, which is a thing to say back rather than an error page.
      error = isAppError(caught)
        ? caught.message
        : 'Enter the whole reference — ARC-1234-5678 or STAY-0001.'
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Find a booking</h1>
        <p className="text-sand-600 mt-1 text-sm">
          A guest’s order reference (ARC-…) or their stay reference (STAY-…) — whichever one they
          are reading out. Only this property’s bookings are searched.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1">
              <span className="text-sand-700 text-sm font-medium">Reference</span>
              <input
                type="text"
                name="ref"
                defaultValue={ref ?? ''}
                placeholder="ARC-1234-5678"
                autoComplete="off"
                spellCheck={false}
                className="border-sand-300 mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm uppercase"
              />
            </label>
            <Button type="submit">Find it</Button>
          </form>
          {error !== null ? (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {result === null ? null : result.stays.length === 0 ? (
        <EmptyState
          title={`Nothing here matches ${result.reference}`}
          description="Check the reference, and that the guest booked with this property. A reference from another hotel will not be found here."
        />
      ) : (
        <div className="space-y-4">
          {result.stays.map((stay) => (
            <Card key={stay.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <CardTitle className="text-base">
                    {stay.guest === null
                      ? 'Guest not on file'
                      : `${stay.guest.firstName} ${stay.guest.lastName}`}
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* ADR-042: a direct trip is not a room booking and must never read as one. */}
                    <Badge tone={stay.kind === 'DIRECT' ? 'accent' : 'neutral'}>
                      {stay.kind === 'DIRECT' ? 'Direct trip — no room' : 'Room booking'}
                    </Badge>
                    <Badge tone="neutral">{stay.reference}</Badge>
                  </div>
                </div>
                <p className="text-sand-600 text-sm tabular-nums">
                  {toDateKey(stay.checkIn)} → {toDateKey(stay.checkOut)} · {stay.status}
                </p>
              </CardHeader>

              <CardContent className="space-y-3">
                {stay.orders.length === 0 ? (
                  <p className="text-sand-600 text-sm">Nothing booked on this stay yet.</p>
                ) : (
                  stay.orders.map((order) => (
                    <div key={order.id} className="border-sand-200 rounded-xl border p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-mono text-sm">{order.reference}</p>
                        <div className="flex items-center gap-2">
                          <Badge tone="neutral">{order.status}</Badge>
                          <Money
                            amountMinor={order.totalMinor}
                            currency={order.currency}
                            intent="neutral"
                            className="font-semibold"
                          />
                        </div>
                      </div>
                      <ul className="text-sand-700 mt-2 space-y-1 text-sm">
                        {order.items.map((item) => (
                          <li key={item.id} className="flex flex-wrap justify-between gap-2">
                            <span className="tabular-nums">
                              {toDateKey(item.slot.startsAt)} {toLocalTimeString(item.slot.startsAt)}{' '}
                              — {item.experience.titleEn} ×{item.quantity}
                            </span>
                            {/*
                              * Whose answer the guest is waiting on, in the
                              * words the partner's own page uses. The desk
                              * cannot confirm on a partner's behalf.
                              */}
                            <span className="text-sand-500 text-xs">
                              {item.cancelledAt !== null
                                ? 'Cancelled'
                                : item.supplierConfirmedAt !== null
                                  ? `Confirmed by ${item.experience.supplier.name}`
                                  : `Waiting on ${item.experience.supplier.name} to confirm`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}

                <p className="text-sand-500 text-xs">
                  <Link
                    href={`/g/${stay.portalToken}`}
                    className="text-jade-800 underline underline-offset-4"
                  >
                    Open the guest’s portal
                  </Link>{' '}
                  — this link is their only credential, so read it out rather than forwarding it.
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
