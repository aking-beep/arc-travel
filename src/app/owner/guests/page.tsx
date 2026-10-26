import Link from 'next/link'
import { KeyRound, Link2, Printer, UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { addDays, toDateKey } from '@/lib/dates'
import { StayStatus } from '@/lib/prisma-types'
import { requireActor } from '@/modules/auth/service'
import { getPropertyOverview, resolveOperatingProperty } from '@/modules/hotels/service'
import { listStays } from '@/modules/stays/service'
import { CreateStayForm, ReissueTokenForm, StayStatusForm, SendPortalLinkForm} from './forms'

export const metadata = { title: 'Guests' }

/**
 * The front desk's guest list.
 *
 * This is step five of the commercial journey, which had no route at all: with
 * no way to create a `Guest` and a `Stay`, nothing minted a portal token and
 * the whole guest surface was unreachable for a real guest.
 *
 * The portal link is shown here, in full, on purpose — the person reading this
 * page is the person who hands it over at check-in. It is the guest's only
 * credential, so the page says so and offers a replacement for the case where
 * a key card gets photographed.
 */
const NEXT_STATUSES: Record<StayStatus, Array<{ value: StayStatus; label: string }>> = {
  [StayStatus.BOOKED]: [
    { value: StayStatus.IN_HOUSE, label: 'Checked in' },
    { value: StayStatus.CANCELLED, label: 'Cancelled' },
    { value: StayStatus.NO_SHOW, label: 'No show' },
  ],
  [StayStatus.IN_HOUSE]: [
    { value: StayStatus.CHECKED_OUT, label: 'Checked out' },
    { value: StayStatus.CANCELLED, label: 'Cancelled' },
  ],
  [StayStatus.CHECKED_OUT]: [],
  [StayStatus.CANCELLED]: [],
  [StayStatus.NO_SHOW]: [],
}

const TONE: Record<StayStatus, 'brand' | 'neutral' | 'warning' | 'success'> = {
  [StayStatus.BOOKED]: 'brand',
  [StayStatus.IN_HOUSE]: 'success',
  [StayStatus.CHECKED_OUT]: 'neutral',
  [StayStatus.CANCELLED]: 'warning',
  [StayStatus.NO_SHOW]: 'warning',
}

export default async function GuestsPage() {
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)

  const [stays, overview] = await Promise.all([
    listStays(actor, propertyId),
    getPropertyOverview(actor, propertyId),
  ])

  // Computed on the server so the form takes no reading of the clock.
  const today = toDateKey(new Date())

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Guests</h1>
        <p className="text-sand-600 mt-1 text-sm">
          Every stay from three days ago onwards. Creating one mints the guest’s portal link,
          which is what the QR code at the desk points at.
        </p>
      </div>

      {stays.length === 0 ? (
        <EmptyState
          title="No stays yet"
          description="Create one below and you will get a portal link to hand over at check-in."
          icon={<UserPlus className="size-5" aria-hidden />}
        />
      ) : (
        <div className="space-y-4">
          {stays.map((stay) => (
            <Card key={stay.id} data-testid="stay-card">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">
                      {stay.guest.firstName} {stay.guest.lastName}
                    </CardTitle>
                    <p className="text-sand-600 text-sm">
                      {stay.reference} · {stay.checkIn} → {stay.checkOut} ·{' '}
                      {stay.adults + stay.children}{' '}
                      {stay.adults + stay.children === 1 ? 'guest' : 'guests'}
                      {stay.roomType ? ` · ${stay.roomType.code}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={TONE[stay.status]}>{stay.status.replace('_', ' ')}</Badge>
                    {stay.guest.intakeCompletedAt ? (
                      <Badge tone="neutral">Intake done</Badge>
                    ) : (
                      <Badge tone="neutral">Intake pending</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="bg-sand-100 border-sand-300 rounded-xl border px-4 py-3">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <KeyRound className="text-sand-600 size-4" aria-hidden />
                    Portal link
                  </p>
                  {stay.portalLive ? (
                    <>
                      <p className="mt-1 font-mono text-xs break-all" data-testid="portal-token">
                        /g/{stay.portalToken}
                      </p>
                      <p className="text-sand-600 mt-1 text-xs leading-relaxed">
                        Works until {stay.portalExpiresOn}. This link is the guest’s only
                        credential — anyone holding it can see this stay’s plan and basket.
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-4">
                        <Link
                          href={`/owner/guests/${stay.id}/card`}
                          className="text-jade-800 inline-flex items-center gap-1.5 text-sm underline underline-offset-4"
                        >
                          <Printer className="size-4" aria-hidden />
                          Arrival card
                        </Link>
                        <Link
                          href={`/g/${stay.portalToken}`}
                          className="text-jade-800 inline-flex items-center gap-1.5 text-sm underline underline-offset-4"
                        >
                          <Link2 className="size-4" aria-hidden />
                          Open the portal
                        </Link>
                      </div>
                    </>
                  ) : (
                    <p className="text-sand-600 mt-1 text-xs leading-relaxed">
                      Not live: the stay is closed or the grace window has passed
                      ({stay.portalExpiresOn}).
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-end justify-between gap-4">
                  <StayStatusForm stayId={stay.id} options={NEXT_STATUSES[stay.status]} />
                  {stay.portalLive ? <SendPortalLinkForm stayId={stay.id} /> : null}
                  {stay.portalLive ? <ReissueTokenForm stayId={stay.id} /> : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a stay</CardTitle>
          <p className="text-sand-600 text-sm">
            A guest is identified by their email at this property, so a returning guest keeps the
            preferences they gave you last time.
          </p>
        </CardHeader>
        <CardContent>
          <CreateStayForm
            roomTypes={overview.roomTypes.map((room) => ({
              id: room.id,
              code: room.code,
              name: room.name,
            }))}
            defaultCheckIn={today}
            defaultCheckOut={addDays(today, 3)}
          />
        </CardContent>
      </Card>
    </div>
  )
}
