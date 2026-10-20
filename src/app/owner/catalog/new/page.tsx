import { LinkButton } from '@/components/ui/button'
import { requireActor } from '@/modules/auth/service'
import { getCatalogFormOptions } from '@/modules/catalog/service'
import { resolveOperatingProperty } from '@/modules/hotels/service'
import { createExperienceAction } from '../actions'
import { ExperienceForm } from '../experience-form'

export const metadata = { title: 'New experience' }

export default async function NewExperiencePage({
  searchParams,
}: {
  searchParams: Promise<{ amenity?: string; category?: string }>
}) {
  const { amenity, category } = await searchParams
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)
  const { suppliers, activities, places } = await getCatalogFormOptions(actor, propertyId)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">New experience</h1>
          <p className="text-sand-600 mt-1 text-sm">
            {amenity
              ? `Turning “${amenity}” into something a guest can book.`
              : 'Something a guest can see, understand and add to a basket.'}
          </p>
        </div>
        <LinkButton href="/owner/catalog" variant="ghost" size="sm">
          Back to catalog
        </LinkButton>
      </div>

      <ExperienceForm
        action={createExperienceAction}
        submitLabel="Save draft"
        suppliers={suppliers}
        activities={activities}
        places={places}
        values={{
          supplierId: '',
          activityId: '',
          placeId: '',
          titleEn: amenity ?? '',
          titleEs: '',
          summaryEn: '',
          summaryEs: '',
          descriptionEn: '',
          descriptionEs: '',
          category: category ?? 'SURF',
          durationMinutes: 120,
          minAbility: 'BEGINNER',
          maxAbility: 'EXPERT',
          minParty: 1,
          maxParty: 6,
          minAgeYears: '',
          defaultCapacity: 6,
          includesTransfer: false,
          guideIncluded: true,
          meetingPoint: '',
          whatToBringEn: '',
          whatToBringEs: '',
          cancellationPolicyHours: 24,
          price: '0',
          bookingFee: '0',
        }}
      />
    </div>
  )
}
