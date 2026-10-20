import { CheckCircle2, CircleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Money } from '@/components/money'
import { requireActor } from '@/modules/auth/service'
import { checkPublishReadiness, getCatalogFormOptions, getExperienceForEdit } from '@/modules/catalog/service'
import { ExperienceStatus } from '@/lib/prisma-types'
import { toLocalDateKey, toLocalTimeString } from '@/lib/dates'
import { updateExperienceAction } from '../actions'
import { ExperienceForm } from '../experience-form'
import { PublishControls, SlotComposer } from './controls'

export const metadata = { title: 'Edit experience' }

export default async function EditExperiencePage({
  params,
}: {
  params: Promise<{ experienceId: string }>
}) {
  const { experienceId } = await params
  const actor = await requireActor()
  const experience = await getExperienceForEdit(actor, experienceId)
  const [{ suppliers, activities, places }, readiness] = await Promise.all([
    getCatalogFormOptions(actor, experience.propertyId),
    checkPublishReadiness(experienceId),
  ])

  const basePrice =
    experience.prices.find((p) => p.kind === 'BASE') ?? experience.prices[0] ?? null

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold">{experience.titleEn}</h1>
            <Badge tone={experience.status === ExperienceStatus.PUBLISHED ? 'success' : 'neutral'}>
              {experience.status}
            </Badge>
          </div>
          <p className="text-sand-600 mt-1 text-sm">
            {experience.supplier.name} · {experience.activity.name}
          </p>
        </div>
        <LinkButton href="/owner/catalog" variant="ghost" size="sm">
          Back to catalog
        </LinkButton>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <ExperienceForm
            action={updateExperienceAction}
            submitLabel="Save changes"
            suppliers={suppliers}
            activities={activities}
            places={places}
            values={{
              experienceId: experience.id,
              supplierId: experience.supplierId,
              activityId: experience.activityId,
              placeId: experience.placeId ?? '',
              titleEn: experience.titleEn,
              titleEs: experience.titleEs ?? '',
              summaryEn: experience.summaryEn ?? '',
              summaryEs: experience.summaryEs ?? '',
              descriptionEn: experience.descriptionEn ?? '',
              descriptionEs: experience.descriptionEs ?? '',
              category: experience.category,
              durationMinutes: experience.durationMinutes,
              minAbility: experience.minAbility,
              maxAbility: experience.maxAbility,
              minParty: experience.minParty,
              maxParty: experience.maxParty,
              minAgeYears: experience.minAgeYears ?? '',
              defaultCapacity: experience.defaultCapacity,
              includesTransfer: experience.includesTransfer,
              guideIncluded: experience.guideIncluded,
              meetingPoint: experience.meetingPoint ?? '',
              whatToBringEn: experience.whatToBringEn ?? '',
              whatToBringEs: experience.whatToBringEs ?? '',
              cancellationPolicyHours: experience.cancellationPolicyHours,
              price: String(Math.round((basePrice?.amountMinor ?? 0) / 100)),
              bookingFee: String(Math.round((basePrice?.bookingFeeMinor ?? 0) / 100)),
            }}
          />
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ready to publish?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {readiness.blockers.length === 0 ? (
                <p className="flex items-start gap-2 text-emerald-800">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                  Everything required is in place.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {readiness.blockers.map((blocker) => (
                    <li key={blocker} className="flex items-start gap-2 text-red-800">
                      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                      {blocker}
                    </li>
                  ))}
                </ul>
              )}

              {readiness.warnings.length > 0 ? (
                <div className="border-sand-200 border-t pt-3">
                  <p className="text-sand-500 text-xs font-medium uppercase">Worth knowing</p>
                  <ul className="text-sand-600 mt-1.5 space-y-1.5 text-[0.8125rem]">
                    {readiness.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <PublishControls
                experienceId={experience.id}
                status={experience.status}
                canPublish={readiness.ready}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Active prices</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-sand-200 divide-y text-sm">
                {experience.prices.map((price) => (
                  <li key={price.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      <Badge tone="neutral">{price.kind}</Badge>
                      {price.minParty > 1 ? (
                        <span className="text-sand-500 ml-2 text-xs">{price.minParty}+ people</span>
                      ) : null}
                    </span>
                    <Money amountMinor={price.amountMinor} currency={price.currency} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upcoming departures</CardTitle>
              <p className="text-sand-600 text-sm">
                {experience.slots.length} in the next few weeks.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {experience.slots.length === 0 ? (
                <p className="text-sand-600 text-sm">
                  None yet. Add one here, or ask the partner to publish their availability.
                </p>
              ) : (
                <ul className="divide-sand-200 max-h-64 divide-y overflow-y-auto text-sm">
                  {experience.slots.map((slot) => (
                    <li key={slot.id} className="flex items-center justify-between gap-2 py-2">
                      <span className="tabular-nums">
                        {toLocalDateKey(slot.startsAt)} · {toLocalTimeString(slot.startsAt)}
                      </span>
                      <span className="text-sand-600 text-xs">
                        {slot.booked}/{slot.capacity}
                        {slot.held > 0 ? ` (+${slot.held} held)` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <SlotComposer
                experienceId={experience.id}
                defaultCapacity={experience.defaultCapacity}
                earliestStart={experience.activity.earliestStart}
              />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}
