import { AlertTriangle, Plus, ShieldQuestion } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { Money } from '@/components/money'
import { requireActor } from '@/modules/auth/service'
import { listAmenityGaps, listCatalog } from '@/modules/catalog/service'
import { resolveOperatingProperty } from '@/modules/hotels/service'
import { ExperienceStatus, VerificationStatus } from '@/lib/prisma-types'

export const metadata = { title: 'Catalog' }

const STATUS_TONE = {
  [ExperienceStatus.PUBLISHED]: 'success',
  [ExperienceStatus.DRAFT]: 'neutral',
  [ExperienceStatus.PENDING_REVIEW]: 'warning',
  [ExperienceStatus.PAUSED]: 'warning',
  [ExperienceStatus.ARCHIVED]: 'neutral',
} as const

export default async function CatalogPage() {
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)
  const [experiences, gaps] = await Promise.all([
    listCatalog(actor, propertyId),
    listAmenityGaps(actor, propertyId),
  ])

  const published = experiences.filter((e) => e.status === ExperienceStatus.PUBLISHED)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Experience catalog</h1>
          <p className="text-sand-600 mt-1 text-sm">
            {published.length} published of {experiences.length}. Only published experiences with a
            price and a departure can reach a guest’s itinerary.
          </p>
        </div>
        <LinkButton href="/owner/catalog/new">
          <Plus className="size-4" aria-hidden />
          New experience
        </LinkButton>
      </div>

      {experiences.length === 0 ? (
        <EmptyState
          title="No experiences yet"
          description="Start with something you already do well — a surf lesson at the cove, or the transfer your front desk books by hand every week."
          action={<LinkButton href="/owner/catalog/new">Create the first one</LinkButton>}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {experiences.map((experience) => {
            const basePrice = experience.prices.find((p) => p.kind === 'BASE') ?? experience.prices[0]
            const unverifiedPartner =
              experience.supplier.verification !== VerificationStatus.VERIFIED

            return (
              <Card key={experience.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle className="text-base">
                      <a
                        href={`/owner/catalog/${experience.id}`}
                        className="hover:text-jade-800 underline-offset-4 hover:underline"
                      >
                        {experience.titleEn}
                      </a>
                    </CardTitle>
                    <Badge tone={STATUS_TONE[experience.status]}>{experience.status}</Badge>
                  </div>
                  <p className="text-sand-600 text-sm">
                    {experience.supplier.name}
                    {experience.place ? ` · ${experience.place.name}` : ''}
                  </p>
                </CardHeader>

                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone="brand">{experience.category}</Badge>
                    <Badge tone="neutral">{experience.durationMinutes} min</Badge>
                    <Badge tone="neutral">
                      {experience.minAbility} – {experience.maxAbility}
                    </Badge>
                    <Badge tone="neutral">cap {experience.defaultCapacity}</Badge>
                  </div>

                  <dl className="text-sand-700 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <dt className="text-sand-500 text-xs">Price</dt>
                      <dd className="font-medium">
                        {basePrice ? (
                          <Money amountMinor={basePrice.amountMinor} currency={basePrice.currency} intent="neutral" />
                        ) : (
                          <span className="text-red-700">Not set</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sand-500 text-xs">Departures</dt>
                      <dd className="font-medium">{experience._count.slots}</dd>
                    </div>
                    <div>
                      <dt className="text-sand-500 text-xs">Sold (demo)</dt>
                      <dd className="font-medium">{experience._count.orderItems}</dd>
                    </div>
                  </dl>

                  {unverifiedPartner ? (
                    <p className="text-sand-600 flex items-start gap-1.5 text-xs">
                      <ShieldQuestion className="mt-px size-3.5 shrink-0" aria-hidden />
                      {experience.supplier.name} is unverified. Guests see a notice saying ARC has
                      not checked this partner’s documents.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {gaps.length > 0 ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-600" aria-hidden />
              <CardTitle className="text-base">
                {gaps.length} amenities are not sellable yet
              </CardTitle>
            </div>
            <p className="text-sand-600 text-sm">
              These are recorded on the property but have no experience attached, so they cannot
              appear in a guest itinerary or earn anything.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="divide-sand-200 divide-y text-sm">
              {gaps.map((gap) => (
                <li key={gap.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <p className="font-medium">{gap.name}</p>
                    {gap.description ? (
                      <p className="text-sand-500 text-xs">{gap.description}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{gap.category}</Badge>
                    <LinkButton
                      href={`/owner/catalog/new?amenity=${encodeURIComponent(gap.name)}&category=${gap.category}`}
                      variant="outline"
                      size="sm"
                    >
                      Make it sellable
                    </LinkButton>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
