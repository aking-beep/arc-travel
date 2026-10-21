import { prisma } from '@/lib/db'
import { ExperienceCategory } from '@/lib/prisma-types'
import { getIntegrations } from '@/modules/integrations/defaults'
import type { TravelAdviceProvider } from '@/modules/integrations/types'
import type { PortalContext } from '@/modules/guest/portal'
import { buildBrief, unsupportedDestinationBrief } from './brief'
import { countryForDestination, type DestinationCountry } from './destinations'
import { govukSourceKey } from './govuk'
import type { Brief } from './schemas'
import { getPublishedChangeNotice, type PublishedChangeNotice } from './snapshots'

/**
 * The guest's culture brief.
 *
 * The profile comes from the portal context and what the guest already told
 * the intake, not from a new form. `resolvePortalContext` is the guest
 * authorisation boundary, and the guest lookup is scoped by the context it
 * produced, so this cannot be pointed at another guest.
 */

/**
 * What an intake interest says about activities the brief can rank by.
 *
 * Deliberately sparse. DINING is not "nightlife" and TRANSPORT (taxis,
 * shuttles) is not "driving". A guessed activity would only reorder the
 * brief, but it would put a wrong reason next to an item.
 */
export const ACTIVITIES_BY_INTEREST: Record<ExperienceCategory, readonly string[]> = {
  [ExperienceCategory.SURF]: ['surfing'],
  [ExperienceCategory.ADVENTURE]: ['hiking'],
  [ExperienceCategory.WELLNESS]: [],
  [ExperienceCategory.DINING]: [],
  [ExperienceCategory.TRANSPORT]: [],
  [ExperienceCategory.CULTURE]: [],
}

export interface GuestCultureBrief {
  brief: Brief
  country: DestinationCountry | null
  /** Present only for a change an admin VERIFIED. */
  changeNotice: PublishedChangeNotice | null
}

export async function getGuestCultureBrief(
  context: PortalContext,
  options: { travelAdvice?: TravelAdviceProvider; now?: Date } = {},
): Promise<GuestCultureBrief> {
  const now = options.now ?? new Date()

  const [guest, place] = await Promise.all([
    prisma.guest.findFirst({
      where: {
        id: context.guestId,
        organizationId: context.organizationId,
        propertyId: context.propertyId,
      },
      select: { countryCode: true, interests: true },
    }),
    context.property.placeId
      ? prisma.place.findUnique({
          where: { id: context.property.placeId },
          select: { destination: true },
        })
      : Promise.resolve(null),
  ])

  const country = countryForDestination(place?.destination)
  if (!guest || !country) {
    return { brief: unsupportedDestinationBrief(now), country: null, changeNotice: null }
  }

  const residence = guest.countryCode && /^[A-Za-z]{2}$/.test(guest.countryCode)
    ? guest.countryCode
    : null

  const [brief, changeNotice] = await Promise.all([
    buildBrief(
      {
        // ARC does not ask for a passport nationality. Where a guest is from is
        // not the passport they hold, so it is not used as one.
        nationality: null,
        residenceCountry: residence,
        destinationCountry: country.countryCode,
        destinationSlug: country.govukSlug,
        purpose: 'TOURISM',
        activities: [...new Set(guest.interests.flatMap((i) => ACTIVITIES_BY_INTEREST[i]))],
      },
      { travelAdvice: options.travelAdvice ?? getIntegrations().travelAdvice, now },
    ),
    getPublishedChangeNotice(govukSourceKey(country.govukSlug)),
  ])

  return { brief, country, changeNotice }
}
