import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { requireActor } from '@/modules/auth/service'
import { getCatalogFormOptions } from '@/modules/catalog/service'
import { listPartners, resolveOperatingProperty } from '@/modules/hotels/service'
import { VerificationStatus } from '@/lib/prisma-types'
import { PartnerInviteForm } from './forms'

export const metadata = { title: 'Partners' }

export default async function PartnersPage() {
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)
  const [partners, { places }] = await Promise.all([
    listPartners(actor, propertyId),
    getCatalogFormOptions(actor, propertyId),
  ])

  const unverified = partners.filter((p) => p.verification !== VerificationStatus.VERIFIED)

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Partners</h1>
        <p className="text-sand-600 mt-1 text-sm">
          The operators who actually deliver the experiences. {partners.length} on file,{' '}
          {unverified.length} not yet verified by ARC.
        </p>
      </div>

      <div className="space-y-4">
        {partners.map((partner) => {
          const agreement = partner.agreements[0]
          const verified = partner.verification === VerificationStatus.VERIFIED

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
                    {verified ? 'Verified by ARC' : 'Not verified by ARC'}
                  </p>
                  <p className="text-sand-600 mt-1 text-xs leading-relaxed">
                    {verified
                      ? 'Documents have been checked and recorded.'
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
