import Link from 'next/link'
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Money } from '@/components/money'
import { requireActor } from '@/modules/auth/service'
import { getOnboardingState, getPropertyOverview, listArrivals, resolveOperatingProperty } from '@/modules/hotels/service'
import { prisma } from '@/lib/db'
import { fromDateKey, toDateKey } from '@/lib/dates'

export const metadata = { title: 'Dashboard' }

export default async function OwnerDashboardPage() {
  const actor = await requireActor()
  const { organizationId, propertyId } = await resolveOperatingProperty(actor)

  const today = fromDateKey(toDateKey(new Date()))

  const [property, onboarding, arrivals, earned, pendingProposals, publishedCount] = await Promise.all([
    getPropertyOverview(actor, propertyId),
    getOnboardingState(actor, propertyId),
    listArrivals(actor, propertyId, { fromDate: today, days: 7 }),
    prisma.order.aggregate({
      where: { propertyId, status: 'CONFIRMED' },
      _sum: { hotelEarningsMinor: true, totalMinor: true },
      _count: true,
    }),
    prisma.proposal.count({ where: { propertyId, status: 'PENDING_APPROVAL' } }),
    prisma.experience.count({ where: { propertyId, status: 'PUBLISHED' } }),
  ])

  const arrivingToday = arrivals.filter(
    (s) => toDateKey(s.checkIn) === toDateKey(today) && s.status === 'BOOKED',
  )
  const needsIntake = arrivals.filter((s) => !s.guest.intakeCompletedAt)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">{property.name}</h1>
        <p className="text-sand-600 mt-1 text-sm">
          {property.roomCount} rooms · {property.place?.name ?? 'No neighbourhood set'} ·{' '}
          {publishedCount} published experiences
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sand-600 text-xs font-medium tracking-wide uppercase">
              Earned from experiences
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              <Money
                amountMinor={earned._sum.hotelEarningsMinor ?? 0}
                currency={property.currency}
                intent="earned"
              />
            </p>
            <p className="text-sand-500 mt-1 text-xs">
              Your share of {earned._count} simulated orders. Not room revenue.
            </p>
            <Badge tone="demo" className="mt-2">
              Simulated
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sand-600 text-xs font-medium tracking-wide uppercase">
              Arriving today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{arrivingToday.length}</p>
            <p className="text-sand-500 mt-1 text-xs">
              {arrivals.length} arrivals in the next seven days.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sand-600 text-xs font-medium tracking-wide uppercase">
              Awaiting your decision
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{pendingProposals}</p>
            <p className="text-sand-500 mt-1 text-xs">
              ARC drafts actions. Nothing happens until you approve.
            </p>
            {pendingProposals > 0 ? (
              <Link
                href="/owner/approvals"
                className="text-jade-800 mt-2 inline-flex items-center gap-1 text-xs underline underline-offset-4"
              >
                Review them <ArrowRight className="size-3" aria-hidden />
              </Link>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sand-600 text-xs font-medium tracking-wide uppercase">
              Guests without preferences
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{needsIntake.length}</p>
            <p className="text-sand-500 mt-1 text-xs">
              Arriving soon and not yet through intake, so nothing can be personalised for them.
            </p>
          </CardContent>
        </Card>
      </div>

      {onboarding.completed < onboarding.total ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Setup · {onboarding.completed} of {onboarding.total} done
            </CardTitle>
            <p className="text-sand-600 text-sm">
              Each step is checked against what is actually stored, not a progress flag.
            </p>
          </CardHeader>
          <CardContent>
            <ol className="divide-sand-200 divide-y">
              {onboarding.steps.map((step) => (
                <li key={step.key} className="flex items-start gap-3 py-3">
                  {step.done ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
                  ) : (
                    <Circle className="text-sand-300 mt-0.5 size-5 shrink-0" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={step.done ? 'text-sand-500 line-through' : 'font-medium'}>
                      {step.label}
                    </p>
                    <p className="text-sand-600 text-sm">{step.description}</p>
                  </div>
                  {!step.done ? (
                    <LinkButton href={step.href} variant="outline" size="sm">
                      Do it
                    </LinkButton>
                  ) : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Next arrivals</CardTitle>
          </CardHeader>
          <CardContent>
            {arrivals.length === 0 ? (
              <p className="text-sand-600 text-sm">Nothing booked in the next seven days.</p>
            ) : (
              <ul className="divide-sand-200 divide-y text-sm">
                {arrivals.slice(0, 6).map((stay) => (
                  <li key={stay.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {stay.guest.firstName} {stay.guest.lastName}
                      </p>
                      <p className="text-sand-500 text-xs tabular-nums">
                        {toDateKey(stay.checkIn)} → {toDateKey(stay.checkOut)} ·{' '}
                        {stay.roomType?.name ?? 'No room assigned'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {stay.guest.intakeCompletedAt ? null : (
                        <Badge tone="warning">No preferences</Badge>
                      )}
                      <Badge tone={stay.status === 'IN_HOUSE' ? 'brand' : 'neutral'}>
                        {stay.status === 'IN_HOUSE' ? 'In house' : 'Booked'}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Where ARC is honest with you</CardTitle>
          </CardHeader>
          <CardContent className="text-sand-700 space-y-2.5 text-sm leading-relaxed">
            <p>
              <strong className="text-sand-900">Earned is not potential.</strong> The figure above is
              your share of orders that actually completed. Opportunities live on the briefing and
              are never added in.
            </p>
            <p>
              <strong className="text-sand-900">Your partners are unverified.</strong> All{' '}
              {property._count.supplierAgreements} of them. ARC has not checked documents, and the
              guest portal says so.
            </p>
            <p>
              <strong className="text-sand-900">Nothing is sent on your behalf.</strong> Outbound
              guest messaging is switched off at the environment level for this build.
            </p>
          </CardContent>
        </Card>
      </div>

      <p className="text-sand-400 text-xs">Organization {organizationId.slice(0, 8)} · demo data</p>
    </div>
  )
}
