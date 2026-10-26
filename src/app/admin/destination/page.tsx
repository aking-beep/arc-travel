import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { requireActor } from '@/modules/auth/service'
import { getDestinationGraph } from '@/modules/admin/service'
import { toDateKey } from '@/lib/dates'

export const metadata = { title: 'Destination graph' }

/**
 * The destination graph with its provenance.
 *
 * Reviewing data quality means seeing where each fact came from and when it was
 * last checked, so provenance, verification and freshness are columns rather
 * than metadata hidden behind a detail view.
 */
export default async function DestinationPage() {
  const actor = await requireActor()
  const { places, activities } = await getDestinationGraph(actor)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Destination graph</h1>
        <p className="text-sand-600 mt-1 max-w-prose text-sm leading-relaxed">
          Puerto Escondido as ARC models it: {places.length} places and {activities.length}{' '}
          activities. Every row carries where the fact came from and when it was last reviewed, so
          nothing can be presented to a guest as more certain than it is.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Places</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-sand-500 border-sand-200 border-b text-left text-xs uppercase">
              <tr>
                <th className="px-5 py-2.5 font-medium">Place</th>
                <th className="px-3 py-2.5 font-medium">Kind</th>
                <th className="px-3 py-2.5 font-medium">Baseline risk</th>
                <th className="px-3 py-2.5 font-medium">Provenance</th>
                <th className="px-3 py-2.5 font-medium">Verified</th>
                <th className="px-3 py-2.5 font-medium">Conditions</th>
                <th className="px-3 py-2.5 font-medium">Facts reviewed</th>
                <th className="px-5 py-2.5 font-medium">Links</th>
              </tr>
            </thead>
            <tbody className="divide-sand-200 divide-y">
              {places.map((place) => (
                <tr key={place.id}>
                  <td className="px-5 py-2.5">
                    <p className="font-medium">{place.name}</p>
                    {place.parent ? (
                      <p className="text-sand-500 text-xs">in {place.parent.name}</p>
                    ) : null}
                    {place.safetyNotesEn ? (
                      <p className="text-sand-500 mt-0.5 max-w-xs truncate text-xs">
                        {place.safetyNotesEn}
                      </p>
                    ) : null}
                  </td>
                  <td className="text-sand-600 px-3 py-2.5 text-xs">
                    {place.kind.replace(/_/g, ' ').toLowerCase()}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge
                      tone={
                        place.typicalRisk === 'LOW'
                          ? 'success'
                          : place.typicalRisk === 'MODERATE'
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {place.typicalRisk.toLowerCase()}
                    </Badge>
                  </td>
                  <td className="text-sand-600 px-3 py-2.5 font-mono text-xs">
                    {place.provenance.toLowerCase()}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={place.verification === 'VERIFIED' ? 'success' : 'neutral'}>
                      {place.verification.toLowerCase()}
                    </Badge>
                  </td>
                  <td className="text-sand-600 px-3 py-2.5 text-xs tabular-nums">
                    {place.conditionsCount > 0 ? (
                      <>
                        {place.conditionsCount} reports
                        <br />
                        <span className="text-sand-500">
                          latest{' '}
                          {place.conditionsLatestAt
                            ? place.conditionsLatestAt.toISOString().slice(0, 10)
                            : '—'}
                        </span>
                      </>
                    ) : (
                      <span className="text-sand-500">none</span>
                    )}
                  </td>
                  <td className="text-sand-600 px-3 py-2.5 text-xs tabular-nums">
                    {toDateKey(place.factsUpdatedAt)}
                  </td>
                  <td className="text-sand-600 px-5 py-2.5 text-xs tabular-nums">
                    {place._count.experiences} exp · {place._count.travelFrom} routes
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activities and their safety envelopes</CardTitle>
          <p className="text-sand-600 text-sm">
            These values are the hard gates the itinerary generator enforces. Changing one changes
            what every supplier’s version of that activity may be offered for.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-sand-500 border-sand-200 border-b text-left text-xs uppercase">
              <tr>
                <th className="px-5 py-2.5 font-medium">Activity</th>
                <th className="px-3 py-2.5 font-medium">Category</th>
                <th className="px-3 py-2.5 font-medium">Place</th>
                <th className="px-3 py-2.5 font-medium">Ability range</th>
                <th className="px-3 py-2.5 font-medium">Max risk</th>
                <th className="px-3 py-2.5 font-medium">Guide</th>
                <th className="px-5 py-2.5 font-medium">In catalog</th>
              </tr>
            </thead>
            <tbody className="divide-sand-200 divide-y">
              {activities.map((activity) => (
                <tr key={activity.id}>
                  <td className="px-5 py-2.5">
                    <p className="font-medium">{activity.name}</p>
                    {activity.safetyNotesEn ? (
                      <p className="text-sand-500 mt-0.5 max-w-sm truncate text-xs">
                        {activity.safetyNotesEn}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone="brand">{activity.category}</Badge>
                  </td>
                  <td className="text-sand-600 px-3 py-2.5 text-xs">
                    {activity.place?.name ?? '—'}
                  </td>
                  <td className="text-sand-600 px-3 py-2.5 text-xs">
                    {activity.minAbility} – {activity.maxAbility}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge
                      tone={
                        activity.maxSafeRisk === 'LOW'
                          ? 'success'
                          : activity.maxSafeRisk === 'MODERATE'
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {activity.maxSafeRisk.toLowerCase()}
                    </Badge>
                  </td>
                  <td className="text-sand-600 px-3 py-2.5 text-xs">
                    {activity.guideRequired ? 'Required' : 'Optional'}
                  </td>
                  <td className="text-sand-600 px-5 py-2.5 text-xs tabular-nums">
                    {activity._count.experiences}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
