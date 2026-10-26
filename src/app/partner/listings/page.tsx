import Link from 'next/link'
import { PackagePlus, Tags } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { Money } from '@/components/money'
import { requireActor } from '@/modules/auth/service'
import { listSupplierExperiences, resolveOperatingSupplier } from '@/modules/suppliers/service'
import { listOwnStorefronts } from '@/modules/suppliers/self-service'

export const metadata = { title: 'Your listings' }

const STATUS_TONE = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  PUBLISHED: 'success',
  PAUSED: 'warning',
  ARCHIVED: 'neutral',
} as const

const STATUS_LABEL = {
  DRAFT: 'Draft — only you can see it',
  PENDING_REVIEW: 'With the hotel to publish',
  PUBLISHED: 'On sale',
  PAUSED: 'Paused — no new bookings',
  ARCHIVED: 'Archived',
} as const

/**
 * Everything this partner offers, and what state each listing is in.
 *
 * The status label says who the listing is waiting on rather than naming the
 * enum, because "PENDING_REVIEW" does not tell a partner that the next move is
 * the hotel's.
 */
export default async function PartnerListingsPage() {
  const actor = await requireActor()
  const { supplierId } = await resolveOperatingSupplier(actor)

  const [experiences, storefronts] = await Promise.all([
    listSupplierExperiences(actor, supplierId),
    listOwnStorefronts(actor, supplierId),
  ])

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Your listings</h1>
          <p className="text-sand-600 mt-1 text-sm">
            You write them; the hotel puts them on sale.
          </p>
        </div>
        {storefronts.length > 0 ? (
          <LinkButton href="/partner/listings/new">
            <PackagePlus className="size-4" aria-hidden />
            New listing
          </LinkButton>
        ) : null}
      </div>

      {storefronts.length === 0 ? (
        <EmptyState
          icon={<Tags className="size-6" aria-hidden />}
          title="No hotel has taken you on yet"
          description="A listing sells through one hotel’s storefront, so there is nothing to write until a hotel has an agreement with you. Ask the hotel you are talking to to add you from their partners page."
        />
      ) : experiences.length === 0 ? (
        <EmptyState
          icon={<Tags className="size-6" aria-hidden />}
          title="Nothing listed yet"
          description="Write up one thing you run. It stays a draft, visible only to you and the hotel, until the hotel publishes it."
          action={<LinkButton href="/partner/listings/new">Write the first one</LinkButton>}
        />
      ) : (
        <ul className="space-y-4">
          {experiences.map((experience) => {
            const base = experience.prices.find((p) => p.kind === 'BASE') ?? experience.prices[0]
            const status = experience.status as keyof typeof STATUS_LABEL

            return (
              <li key={experience.id}>
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <CardTitle className="text-base">
                        <Link
                          href={`/partner/listings/${experience.id}`}
                          className="hover:text-jade-800 underline-offset-4 hover:underline"
                        >
                          {experience.titleEn}
                        </Link>
                      </CardTitle>
                      <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                    </div>
                    <p className="text-sand-600 text-sm">
                      {experience.property.name} · {experience.activity.name} ·{' '}
                      {experience.durationMinutes} minutes
                    </p>
                  </CardHeader>
                  <CardContent>
                    <dl className="text-sand-700 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      <div>
                        <dt className="text-sand-500 text-xs">Per person</dt>
                        <dd>
                          {base ? (
                            <Money
                              amountMinor={base.amountMinor}
                              currency={base.currency}
                              intent="neutral"
                            />
                          ) : (
                            'No price yet'
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-sand-500 text-xs">Party</dt>
                        <dd>
                          {experience.minParty}–{experience.maxParty}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-sand-500 text-xs">Places per departure</dt>
                        <dd>{experience.defaultCapacity}</dd>
                      </div>
                      <div>
                        <dt className="text-sand-500 text-xs">Departures scheduled</dt>
                        <dd>{experience._count.slots}</dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
