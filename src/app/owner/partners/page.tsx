import { Inbox, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { requireActor } from '@/modules/auth/service'
import { getCatalogFormOptions } from '@/modules/catalog/service'
import { listPartners, resolveOperatingProperty } from '@/modules/hotels/service'
import { verificationStanding } from '@/modules/admin/verification'
import { listJoinRequests } from '@/modules/suppliers/self-service'
import { JoinDecisionForms, PartnerInviteForm } from './forms'

export const metadata = { title: 'Partners' }

export default async function PartnersPage() {
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)
  const [partners, { places }, joinRequests] = await Promise.all([
    listPartners(actor, propertyId),
    getCatalogFormOptions(actor, propertyId),
    listJoinRequests(actor, propertyId),
  ])

  const pending = joinRequests.filter((r) => r.status === 'PENDING')
  const decided = joinRequests.filter((r) => r.status !== 'PENDING')

  /*
   * One instant for the whole page, and the live answer rather than the stored
   * column: a verification lapses by itself when the insurance certificate on
   * file expires (ADR-036), and an owner reading "verified" about a lapsed
   * partner is the same false claim a guest would be reading.
   */
  const now = new Date()
  const standings = new Map(partners.map((p) => [p.id, verificationStanding(p, now)]))
  const notVerified = partners.filter((p) => standings.get(p.id)?.standing !== 'verified')

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Partners</h1>
        <p className="text-sand-600 mt-1 text-sm">
          The operators who actually deliver the experiences. {partners.length} on file,{' '}
          {notVerified.length} not verified by ARC right now.
        </p>
      </div>

      <div className="space-y-4">
        {partners.map((partner) => {
          const agreement = partner.agreements[0]
          const standing = standings.get(partner.id)
          const verified = standing?.standing === 'verified'

          return (
            <Card key={partner.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <CardTitle className="text-base">{partner.name}</CardTitle>
                  <div className="flex items-center gap-2">
                    {partner.categories.map((c) => (
                      <Badge key={c} tone="brand">
                        {c}
                      </Badge>
                    ))}
                  </div>
                </div>
                {partner.description ? (
                  <p className="text-sand-600 text-sm">{partner.description}</p>
                ) : null}
              </CardHeader>

              <CardContent className="space-y-4">
                <dl className="grid gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-sand-500 text-xs">Your share</dt>
                    <dd className="font-medium tabular-nums">
                      {agreement ? `${(agreement.hotelCommissionBps / 100).toFixed(1)}%` : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sand-500 text-xs">ARC share</dt>
                    <dd className="font-medium tabular-nums">
                      {agreement ? `${(agreement.platformCommissionBps / 100).toFixed(1)}%` : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sand-500 text-xs">Experiences</dt>
                    <dd className="font-medium tabular-nums">{partner._count.experiences}</dd>
                  </div>
                  <div>
                    <dt className="text-sand-500 text-xs">Confirmation</dt>
                    <dd className="font-medium">
                      {agreement?.requiresManualConfirmation ? 'Manual' : 'Automatic'}
                    </dd>
                  </div>
                </dl>

                <div
                  className={
                    verified
                      ? 'rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3'
                      : 'bg-sand-100 border-sand-300 rounded-xl border px-4 py-3'
                  }
                >
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {verified ? (
                      <ShieldCheck className="size-4 text-emerald-700" aria-hidden />
                    ) : (
                      <ShieldAlert className="text-sand-600 size-4" aria-hidden />
                    )}
                    {verified
                      ? 'Verified by ARC'
                      : standing?.standing === 'lapsed'
                        ? 'Verification lapsed'
                        : 'Not verified by ARC'}
                  </p>
                  <p className="text-sand-600 mt-1 text-xs leading-relaxed">
                    {verified
                      ? 'Documents have been checked and recorded.'
                      : standing?.standing === 'lapsed'
                        ? // The cause, then the same claims sentence: a lapsed
                          // verification means the certifications below are
                          // back to being the partner's own claims.
                          `${standing.reason ?? ''} Guests no longer see a verified badge, and the certifications below are claims the partner made, not confirmed facts.`
                        : 'ARC has not checked this partner’s documents. Guests see a notice to that effect, and the certifications below are claims the partner made, not confirmed facts.'}
                  </p>
                  {partner.claimedCertifications.length > 0 ? (
                    <ul className="text-sand-600 mt-2 space-y-0.5 text-xs">
                      {partner.claimedCertifications.map((cert) => (
                        <li key={cert}>· {cert}</li>
                      ))}
                    </ul>
                  ) : null}
                  {!partner.insuranceOnFile ? (
                    <p className="mt-2 text-xs font-medium text-amber-800">
                      No insurance document on file.
                    </p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Inbox className="text-jade-700 size-5" aria-hidden />
          <h2 className="font-display text-xl font-semibold">Businesses asking to work with you</h2>
          {pending.length > 0 ? <Badge tone="warning">{pending.length} waiting</Badge> : null}
        </div>
        <p className="text-sand-600 max-w-prose text-sm leading-relaxed">
          Anyone can send one of these from the ARC Stay site. Nothing has been agreed and nothing
          is published until you accept — and ARC has checked none of what they say about
          themselves. Accepting creates the partner, your agreement and their login, and emails
          them an invitation.
        </p>

        {pending.length === 0 ? (
          <EmptyState
            title="Nothing waiting"
            description="A business that wants to work with you can ask from /sign-up/partner, and it will appear here."
          />
        ) : (
          <ul className="space-y-4">
            {pending.map((request) => (
              <li key={request.id}>
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <CardTitle className="text-base">{request.businessName}</CardTitle>
                      <div className="flex flex-wrap gap-2">
                        {request.categories.map((c) => (
                          <Badge key={c} tone="brand">
                            {c}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <p className="text-sand-600 text-sm">
                      {request.contactName} · {request.contactEmail}
                      {request.contactPhone ? ` · ${request.contactPhone}` : ''}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {request.pitch ? (
                      <p className="text-sand-700 max-w-prose text-sm leading-relaxed whitespace-pre-line">
                        {request.pitch}
                      </p>
                    ) : (
                      <p className="text-sand-500 text-sm">They wrote nothing about themselves.</p>
                    )}

                    {request.claimedCertifications.length > 0 ? (
                      <div className="bg-sand-100 border-sand-300 rounded-xl border px-4 py-3">
                        <p className="text-sand-800 text-sm font-medium">
                          Certifications they say they hold
                        </p>
                        <p className="text-sand-600 mt-1 text-xs leading-relaxed">
                          Their claims. ARC has seen no documents, so do not repeat these to a
                          guest as facts.
                        </p>
                        <ul className="text-sand-600 mt-2 space-y-0.5 text-xs">
                          {request.claimedCertifications.map((cert) => (
                            <li key={cert}>· {cert}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <JoinDecisionForms requestId={request.id} />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}

        {decided.length > 0 ? (
          <details className="border-sand-200 rounded-xl border px-4 py-3">
            <summary className="text-sand-700 cursor-pointer text-sm font-medium">
              {decided.length} you have already decided on
            </summary>
            <ul className="mt-3 space-y-2">
              {decided.map((request) => (
                <li key={request.id} className="text-sand-600 text-sm">
                  <span className="text-sand-800 font-medium">{request.businessName}</span> ·{' '}
                  {request.status === 'ACCEPTED' ? 'accepted' : 'declined'}
                  {request.decidedAt ? ` on ${request.decidedAt.toISOString().slice(0, 10)}` : ''}
                  {request.decisionNote ? ` — ${request.decisionNote}` : ''}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a partner</CardTitle>
          <p className="text-sand-600 text-sm">
            Someone you already work with. They get their own login scoped to their own
            experiences — they cannot see your other partners or your guests.
          </p>
        </CardHeader>
        <CardContent>
          <PartnerInviteForm places={places} />
        </CardContent>
      </Card>
    </div>
  )
}
