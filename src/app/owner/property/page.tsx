import { Badge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Money } from '@/components/money'
import { requireActor } from '@/modules/auth/service'
import { getPropertyOverview, resolveOperatingProperty } from '@/modules/hotels/service'
import { getCatalogFormOptions } from '@/modules/catalog/service'
import { AmenityForm, PropertyProfileForm, RoomTypeForm } from './forms'

export const metadata = { title: 'Property' }

export default async function PropertyPage() {
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)
  const [property, { places }] = await Promise.all([
    getPropertyOverview(actor, propertyId),
    getCatalogFormOptions(actor, propertyId),
  ])

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Property</h1>
        <p className="text-sand-600 mt-1 text-sm">
          What the guest portal shows, and the raw material ARC turns into sellable experiences.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <PropertyProfileForm
            places={places}
            values={{
              name: property.name,
              tagline: property.tagline ?? '',
              description: property.description ?? '',
              houseNotes: property.houseNotes ?? '',
              checkInTime: property.checkInTime,
              checkOutTime: property.checkOutTime,
              defaultLocale: property.defaultLocale,
              brandPrimary: property.brandPrimary,
              brandAccent: property.brandAccent,
              placeId: property.placeId ?? '',
              contactEmail: property.contactEmail ?? '',
              contactPhone: property.contactPhone ?? '',
            }}
          />
        </CardContent>
      </Card>

      <Card id="rooms">
        <CardHeader>
          <CardTitle className="text-base">
            Room types · {property.roomCount} rooms in total
          </CardTitle>
          <p className="text-sand-600 text-sm">
            The total is derived from the rows below, so it cannot drift out of step with them.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {property.roomTypes.length > 0 ? (
            <ul className="divide-sand-200 divide-y text-sm">
              {property.roomTypes.map((rt) => (
                <li key={rt.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {rt.name} <span className="text-sand-400 font-mono text-xs">{rt.code}</span>
                    </p>
                    <p className="text-sand-500 text-xs">
                      {rt.roomCount} rooms · sleeps {rt.maxOccupancy}
                    </p>
                  </div>
                  <Money amountMinor={rt.baseRateMinor} currency={rt.currency} intent="neutral" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sand-600 text-sm">No room types yet.</p>
          )}
          <div className="border-sand-200 border-t pt-5">
            <RoomTypeForm />
          </div>
        </CardContent>
      </Card>

      <Card id="amenities">
        <CardHeader>
          <CardTitle className="text-base">Amenities</CardTitle>
          <p className="text-sand-600 text-sm">
            An amenity with an experience attached can earn. One without is a catalog gap.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <ul className="divide-sand-200 divide-y text-sm">
            {property.amenities.map((amenity) => (
              <li key={amenity.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="font-medium">{amenity.name}</p>
                  {amenity.description ? (
                    <p className="text-sand-500 text-xs">{amenity.description}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone="neutral">{amenity.category}</Badge>
                  {amenity.experience ? (
                    <Badge tone="success">Sellable</Badge>
                  ) : (
                    <LinkButton
                      href={`/owner/catalog/new?amenity=${encodeURIComponent(amenity.name)}&category=${amenity.category}`}
                      variant="outline"
                      size="sm"
                    >
                      Make it sellable
                    </LinkButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="border-sand-200 border-t pt-5">
            <AmenityForm />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
