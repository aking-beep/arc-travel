import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Money } from '@/components/money'
import { requireActor } from '@/modules/auth/service'
import {
  getSupplierEarnings,
  getSupplierProfile,
  listSupplierBookings,
  listSupplierExperiences,
  resolveOperatingSupplier,
} from '@/modules/suppliers/service'
import { verificationStanding } from '@/modules/admin/verification'
import { toDateKey, toLocalTimeString } from '@/lib/dates'

export const metadata = { title: 'Overview' }

export default async function PartnerDashboardPage() {
  const actor = await requireActor()
  const { supplierId } = await resolveOperatingSupplier(actor)

  const [profile, experiences, bookings, earnings] = await Promise.all([
    getSupplierProfile(actor, supplierId),
    listSupplierExperiences(actor, supplierId),
    listSupplierBookings(actor, supplierId),
    getSupplierEarnings(actor, supplierId),
  ])

  // The live answer, so a partner learns their verification has lapsed from
  // their own dashboard rather than from a guest (ADR-036).
  const standing = verificationStanding(profile, new Date())
  const verified = standing.standing === 'verified'
  const unconfirmed = bookings.filter((b) => !b.supplierConfirmedAt)
  const published = experiences.filter((e) => e.status === 'PUBLISHED')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">{profile.name}</h1>
        <p className="text-sand-600 mt-1 text-sm">
          {published.length} of {experiences.length} experiences published
          {profile.place ? ` · based at ${profile.place.name}` : ''}
        </p>
      </div>

      <div
        className={
          verified
            ? 'rounded-xl border border-emerald-200 bg-emerald-50 p-4'
            : 'bg-sand-100 border-sand-300 rounded-xl border p-4'
        }
      >
        <p className="flex items-center gap-2 font-medium">
          {verified ? (
            <ShieldCheck className="size-4 text-emerald-700" aria-hidden />
          ) : (
            <ShieldAlert className="text-sand-600 size-4" aria-hidden />
          )}
          {verified
            ? 'Verified by ARC'
            : standing.standing === 'lapsed'
              ? 'Your verification has lapsed'
              : 'Not yet verified by ARC'}
        </p>
        <p className="text-sand-600 mt-1 text-sm leading-relaxed">
          {verified
            ? 'Your documents are on file and guests see a verified badge.'
            : standing.standing === 'lapsed'
              ? `${standing.reason ?? ''} Guests no longer see a verified badge. Nothing of yours has been unpublished and no booking has been cancelled — send the renewal and ARC will record it again.`
              : 'Guests see a notice saying ARC has not checked your documents, and the certifications on your profile are shown as your own claims. Verification is an ARC review, not something the hotel can grant.'}
        </p>
        {!profile.insuranceOnFile ? (
          <p className="mt-2 text-sm font-medium text-amber-800">No insurance document on file.</p>
        ) : null}
        {!profile.payoutsEnabled ? (
          <p className="text-sand-500 mt-2 text-xs">
            Payouts are off for every partner in this build. Earnings below are a record of what
            would be owed, not a payment.
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sand-600 text-xs font-medium tracking-wide uppercase">
              Owed to you (simulated)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              <Money amountMinor={earnings.payableMinor} currency={earnings.currency} intent="earned" />
            </p>
            <p className="text-sand-500 mt-1 text-xs">
              {earnings.bookingCount} bookings · {earnings.guestsServed} guests
            </p>
            <Badge tone="demo" className="mt-2">
              Demo data
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sand-600 text-xs font-medium tracking-wide uppercase">
              Waiting on you
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{unconfirmed.length}</p>
            <p className="text-sand-500 mt-1 text-xs">
              Bookings you have not confirmed by hand yet.
            </p>
            {unconfirmed.length > 0 ? (
              <LinkButton href="/partner/bookings" variant="outline" size="sm" className="mt-2">
                Confirm them
              </LinkButton>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sand-600 text-xs font-medium tracking-wide uppercase">
              Upcoming departures
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{bookings.length}</p>
            <p className="text-sand-500 mt-1 text-xs">With at least one guest booked on.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Next up</CardTitle>
        </CardHeader>
        <CardContent>
          {bookings.length === 0 ? (
            <p className="text-sand-600 text-sm">Nothing booked yet.</p>
          ) : (
            <ul className="divide-sand-200 divide-y text-sm">
              {bookings.slice(0, 8).map((booking) => (
                <li key={booking.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium">{booking.experience.titleEn}</p>
                    <p className="text-sand-500 text-xs tabular-nums">
                      {toDateKey(booking.slot.startsAt)} {toLocalTimeString(booking.slot.startsAt)} ·{' '}
                      {booking.order.guest?.firstName ?? 'Guest'} ×{booking.quantity}
                    </p>
                  </div>
                  {booking.supplierConfirmedAt ? (
                    <Badge tone="success">Confirmed</Badge>
                  ) : (
                    <Badge tone="warning">Needs confirming</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your agreements</CardTitle>
          <p className="text-sand-600 text-sm">
            What each hotel keeps, and what ARC takes on top. You receive the remainder.
          </p>
        </CardHeader>
        <CardContent>
          <ul className="divide-sand-200 divide-y text-sm">
            {profile.agreements.map((agreement) => {
              const yourShareBps =
                10_000 - agreement.hotelCommissionBps - agreement.platformCommissionBps
              return (
                <li key={agreement.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <p className="font-medium">{agreement.property.name}</p>
                    <p className="text-sand-500 text-xs">
                      Hotel {(agreement.hotelCommissionBps / 100).toFixed(1)}% · ARC{' '}
                      {(agreement.platformCommissionBps / 100).toFixed(1)}% ·{' '}
                      {agreement.cancellationWindowHours}h cancellation window
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">
                    You {(yourShareBps / 100).toFixed(1)}%
                  </span>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
