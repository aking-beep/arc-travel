import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireActor } from '@/modules/auth/service'
import { resolveOperatingSupplier } from '@/modules/suppliers/service'
import {
  getOwnExperienceForEdit,
  listActivityOptions,
  listOwnStorefronts,
  listPlaceOptions,
} from '@/modules/suppliers/self-service'
import { ExperienceForm } from '../experience-form'
import { PauseForm, PriceForm, SubmitForReviewForm } from '../controls'

export const metadata = { title: 'Listing' }

const STATUS_LABEL = {
  DRAFT: 'Draft — only you and the hotel can see it',
  PENDING_REVIEW: 'With the hotel to publish',
  PUBLISHED: 'On sale',
  PAUSED: 'Paused — no new bookings',
  ARCHIVED: 'Archived',
} as const

/** Pesos for a form field, from the centavos the domain stores. */
function toPesos(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2)
}

export default async function PartnerListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ experienceId: string }>
  searchParams: Promise<{ created?: string }>
}) {
  const { experienceId } = await params
  const { created } = await searchParams

  const actor = await requireActor()
  const { supplierId } = await resolveOperatingSupplier(actor)

  const [experience, storefronts, activities, places] = await Promise.all([
    getOwnExperienceForEdit(actor, supplierId, experienceId),
    listOwnStorefronts(actor, supplierId),
    listActivityOptions(actor, supplierId),
    listPlaceOptions(actor, supplierId),
  ])

  const status = experience.status as keyof typeof STATUS_LABEL
  const published = status === 'PUBLISHED'
  const base = experience.prices.find((p) => p.kind === 'BASE') ?? experience.prices[0]
  const canSubmit = status === 'DRAFT' || status === 'PAUSED'
  const canPause = status === 'PUBLISHED' || status === 'PENDING_REVIEW'

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/partner/listings"
          className="text-sand-600 hover:text-sand-900 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden />
          All your listings
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-semibold">{experience.titleEn}</h1>
          <Badge tone={published ? 'success' : status === 'DRAFT' ? 'neutral' : 'warning'}>
            {STATUS_LABEL[status]}
          </Badge>
        </div>
        <p className="text-sand-600 mt-1 text-sm">
          {experience.property.name} · {experience.activity.name}
        </p>
      </div>

      {created === '1' ? (
        <p
          role="status"
          className="border-jade-200 bg-jade-50 text-jade-900 max-w-prose rounded-lg border px-4 py-3 text-sm"
        >
          Saved as a draft. When you are happy with it, send it to the hotel below.
        </p>
      ) : null}

      {canSubmit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ready for the hotel?</CardTitle>
            <CardDescription>
              Sending it tells the hotel to look at it. They publish it, and they can come back to
              you if something is missing — you will see what that is here as soon as you send it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SubmitForReviewForm experienceId={experience.id} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Price</CardTitle>
          <CardDescription>
            {base
              ? 'The current price per person. A change applies to the next guest who books.'
              : 'This listing has no active price, so it cannot be published.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PriceForm
            experienceId={experience.id}
            currentPesos={base ? toPesos(base.amountMinor) : ''}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">The details</CardTitle>
        </CardHeader>
        <CardContent>
          <ExperienceForm
            mode="edit"
            experienceId={experience.id}
            disabled={published}
            options={{ storefronts, activities, places }}
            defaults={{
              propertyId: experience.propertyId,
              activityId: experience.activityId,
              placeId: experience.placeId,
              titleEn: experience.titleEn,
              titleEs: experience.titleEs,
              summaryEn: experience.summaryEn,
              summaryEs: experience.summaryEs,
              descriptionEn: experience.descriptionEn,
              descriptionEs: experience.descriptionEs,
              durationMinutes: experience.durationMinutes,
              minParty: experience.minParty,
              maxParty: experience.maxParty,
              defaultCapacity: experience.defaultCapacity,
              minAgeYears: experience.minAgeYears,
              includesTransfer: experience.includesTransfer,
              guideIncluded: experience.guideIncluded,
              meetingPoint: experience.meetingPoint,
              whatToBringEn: experience.whatToBringEn,
              whatToBringEs: experience.whatToBringEs,
              cancellationPolicyHours: experience.cancellationPolicyHours,
              price: base ? toPesos(base.amountMinor) : '',
            }}
          />
        </CardContent>
      </Card>

      {canPause ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stop taking bookings</CardTitle>
            <CardDescription>
              Pausing takes it off sale and leaves everything already booked exactly as it is — you
              still owe those guests their departure. To cancel a booking, use the booking itself,
              because that is a guest and a refund.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PauseForm experienceId={experience.id} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
