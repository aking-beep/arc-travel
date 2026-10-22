/**
 * Destination to country.
 *
 * `Place.destination` is a slug, and nothing in the destination graph records
 * a country. This is the one place that says which country, and which slug
 * each source uses for it, a destination is in. A destination missing from
 * here gets a brief that says it is not covered. It does not get a guess.
 */
export interface DestinationCountry {
  /** ISO 3166-1 alpha-2. */
  countryCode: string
  nameEn: string
  nameEs: string
  /** The slug under https://www.gov.uk/foreign-travel-advice/. */
  govukSlug: string
}

export const DESTINATION_COUNTRIES: Record<string, DestinationCountry> = {
  'puerto-escondido': {
    countryCode: 'MX',
    nameEn: 'Mexico',
    nameEs: 'México',
    govukSlug: 'mexico',
  },
}

export function countryForDestination(destination: string | null | undefined): DestinationCountry | null {
  if (!destination) return null
  return DESTINATION_COUNTRIES[destination] ?? null
}
