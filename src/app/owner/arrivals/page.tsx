import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { Money } from '@/components/money'
import { requireActor } from '@/modules/auth/service'
import { listArrivals, resolveOperatingProperty } from '@/modules/hotels/service'
import { fromDateKey, toDateKey, toLocalTimeString } from '@/lib/dates'

export const metadata = { title: 'Arrivals' }

export default async function ArrivalsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const { days } = await searchParams
  const window = Math.min(Math.max(Number(days ?? 14), 1), 60)

  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)
  const today = toDateKey(new Date())
  const arrivals = await listArrivals(actor, propertyId, {
    fromDate: fromDateKey(today),
    days: window,
  })

  const grouped = new Map<string, typeof arrivals>()
  for (const stay of arrivals) {
    const key = toDateKey(stay.checkIn)
    const bucket = grouped.get(key) ?? []
    bucket.push(stay)
    grouped.set(key, bucket)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Arrivals</h1>
        <p className="text-sand-600 mt-1 text-sm">
          Next {window} days. What each guest told us, and what they have already booked.
        </p>
      </div>

      {arrivals.length === 0 ? (
        <EmptyState title="No arrivals in this window" />
      ) : (
        <div className="space-y-6">
          {[...grouped.entries()].map(([date, stays]) => (
            <section key={date}>
              <h2 className="text-sand-500 text-xs font-semibold tracking-wide uppercase">
                {date === today ? `Today · ${date}` : date}
              </h2>
              <div className="mt-2 space-y-3">
                {stays.map((stay) => {
                  const bookedItems = stay.orders.flatMap((o) => o.items)
                  const spend = stay.orders.reduce((n, o) => n + o.totalMinor, 0)
                  const hasTransport = bookedItems.some(
                    (item) => item.experience.category === 'TRANSPORT',
                  )

                  return (
                    <Card key={stay.id}>
                      <CardHeader className="pb-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <CardTitle className="text-base">
                            {stay.guest.firstName} {stay.guest.lastName}
                          </CardTitle>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={stay.status === 'IN_HOUSE' ? 'brand' : 'neutral'}>
                              {stay.status === 'IN_HOUSE' ? 'In house' : 'Booked'}
                            </Badge>
                            <Badge tone="neutral">{stay.reference}</Badge>
                          </div>
                        </div>
                        <p className="text-sand-600 text-sm tabular-nums">
                          {toDateKey(stay.checkIn)} → {toDateKey(stay.checkOut)} ·{' '}
                          {stay.roomType?.name ?? 'No room assigned'} · {stay.adults + stay.children}{' '}
                          guests
                        </p>
                      </CardHeader>

                      <CardContent className="space-y-3">
                        <div className="flex flex-wrap gap-2 text-xs">
                          {stay.guest.intakeCompletedAt ? (
                            <>
                              {stay.guest.surfAbility ? (
                                <Badge tone="brand">Surf: {stay.guest.surfAbility}</Badge>
                              ) : null}
                              {stay.guest.pace ? <Badge tone="neutral">{stay.guest.pace}</Badge> : null}
                              {stay.guest.interests.map((i) => (
                                <Badge key={i} tone="neutral">
                                  {i}
                                </Badge>
                              ))}
                            </>
                          ) : (
                            <Badge tone="warning">
                              No preferences — send them the portal link
                            </Badge>
                          )}
                          {!hasTransport ? (
                            <Badge tone="accent">No transport booked</Badge>
                          ) : null}
                        </div>

                        {stay.guest.mobilityNotes || stay.guest.dietaryNotes ? (
                          <div className="bg-sand-100 text-sand-700 rounded-lg px-3 py-2 text-xs">
                            {stay.guest.mobilityNotes ? (
                              <p>Mobility: {stay.guest.mobilityNotes}</p>
                            ) : null}
                            {stay.guest.dietaryNotes ? <p>Food: {stay.guest.dietaryNotes}</p> : null}
                          </div>
                        ) : null}

                        {bookedItems.length > 0 ? (
                          <div>
                            <p className="text-sand-500 text-xs font-medium uppercase">
                              Booked · <Money amountMinor={spend} currency="MXN" /> simulated
                            </p>
                            <ul className="text-sand-700 mt-1 space-y-0.5 text-sm">
                              {bookedItems.map((item) => (
                                <li key={item.id} className="tabular-nums">
                                  {toDateKey(item.slot.startsAt)} {toLocalTimeString(item.slot.startsAt)}{' '}
                                  — {item.experience.titleEn} ×{item.quantity}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <p className="text-sand-600 text-sm">Nothing booked yet.</p>
                        )}

                        <p className="text-sand-400 font-mono text-xs">
                          Portal link: /g/{stay.portalToken}
                        </p>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
