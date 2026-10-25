import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { Money } from '@/components/money'
import { requireActor } from '@/modules/auth/service'
import {
  listSupplierAvailability,
  listSupplierExperiences,
  resolveOperatingSupplier,
} from '@/modules/suppliers/service'
import { addDays, toDateKey, toLocalTimeString } from '@/lib/dates'
import { CloseSlotForm, ScheduleForm } from '../forms'

export const metadata = { title: 'Availability' }

export default async function AvailabilityPage() {
  const actor = await requireActor()
  const { supplierId } = await resolveOperatingSupplier(actor)

  const today = toDateKey(new Date())
  const [slots, experiences] = await Promise.all([
    listSupplierAvailability(actor, supplierId, { days: 28 }),
    listSupplierExperiences(actor, supplierId),
  ])

  const byDate = new Map<string, typeof slots>()
  for (const slot of slots) {
    const key = toDateKey(slot.startsAt)
    const bucket = byDate.get(key) ?? []
    bucket.push(slot)
    byDate.set(key, bucket)
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Availability</h1>
        <p className="text-sand-600 mt-1 text-sm">
          {slots.length} departures in the next 28 days. “Held” means a guest has places in their
          basket but has not checked out — they count as gone until the hold lapses.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add departures</CardTitle>
        </CardHeader>
        <CardContent>
          {experiences.length === 0 ? (
            <p className="text-sand-600 text-sm">
              You have no experiences yet. The hotel creates these with you.
            </p>
          ) : (
            <ScheduleForm
              experiences={experiences}
              defaultFromDate={today}
              defaultToDate={addDays(today, 14)}
            />
          )}
        </CardContent>
      </Card>

      {byDate.size === 0 ? (
        <EmptyState
          title="No departures scheduled"
          description="Add some above and they become bookable immediately for any published experience."
        />
      ) : (
        <div className="space-y-5">
          {[...byDate.entries()].map(([date, group]) => (
            <section key={date}>
              <h2 className="text-sand-500 text-xs font-semibold tracking-wide uppercase">{date}</h2>
              <ul className="divide-sand-200 mt-2 divide-y">
                {group.map((slot) => (
                  <li key={slot.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        <span className="tabular-nums">{toLocalTimeString(slot.startsAt)}</span>{' '}
                        {slot.experienceTitle}
                      </p>
                      <p className="text-sand-500 text-xs tabular-nums">
                        {slot.booked}/{slot.capacity} booked
                        {slot.held > 0 ? ` · ${slot.held} held` : ''}
                        {slot.remaining > 0 ? ` · ${slot.remaining} free` : ' · full'}
                        {slot.priceOverrideMinor !== null ? (
                          <>
                            {' · '}
                            <Money amountMinor={slot.priceOverrideMinor} currency={slot.currency} intent="neutral" />{' '}
                            override
                          </>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge
                        tone={
                          slot.status === 'OPEN'
                            ? 'success'
                            : slot.status === 'FULL'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {slot.status}
                      </Badge>
                      {slot.status !== 'CLOSED' && slot.status !== 'CANCELLED' ? (
                        <CloseSlotForm slotId={slot.id} booked={slot.booked} />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
