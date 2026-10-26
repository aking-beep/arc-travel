import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireActor } from '@/modules/auth/service'
import { resolveOperatingSupplier } from '@/modules/suppliers/service'
import {
  listActivityOptions,
  listOwnStorefronts,
  listPlaceOptions,
} from '@/modules/suppliers/self-service'
import { ExperienceForm } from '../experience-form'

export const metadata = { title: 'New listing' }

export default async function NewPartnerListingPage() {
  const actor = await requireActor()
  const { supplierId } = await resolveOperatingSupplier(actor)

  const [storefronts, activities, places] = await Promise.all([
    listOwnStorefronts(actor, supplierId),
    listActivityOptions(actor, supplierId),
    listPlaceOptions(actor, supplierId),
  ])

  // Nothing to attach a listing to. The list page explains why; this one would
  // only be a form that cannot be submitted.
  if (storefronts.length === 0) redirect('/partner/listings')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">New listing</h1>
        <p className="text-sand-600 mt-1 text-sm">
          This saves as a draft. Nobody can book it until the hotel publishes it.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">The experience</CardTitle>
          <CardDescription>
            Write it the way you would describe it to somebody at the front desk. The Spanish
            fields are optional, but a guest reading in Spanish sees the English until you fill
            them in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExperienceForm mode="create" options={{ storefronts, activities, places }} />
        </CardContent>
      </Card>
    </div>
  )
}
