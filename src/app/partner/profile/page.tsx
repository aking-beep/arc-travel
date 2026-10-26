import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireActor } from '@/modules/auth/service'
import { getSupplierProfile, resolveOperatingSupplier } from '@/modules/suppliers/service'
import { listPlaceOptions } from '@/modules/suppliers/self-service'
import { verificationStanding } from '@/modules/admin/verification'
import { toDateKey } from '@/lib/dates'
import { EvidenceForm, ProfileForm } from './forms'

export const metadata = { title: 'Your business' }

/**
 * The partner's own page about themselves.
 *
 * Two cards, and the split between them is the whole of ADR-041: above, what
 * they say, which is theirs to change; below, what ARC has checked, which is
 * not. The second card shows their standing and has no control that could
 * change it — only a form that asks for it to be looked at.
 */
export default async function PartnerProfilePage() {
  const actor = await requireActor()
  const { supplierId } = await resolveOperatingSupplier(actor)

  const [profile, places] = await Promise.all([
    getSupplierProfile(actor, supplierId),
    listPlaceOptions(actor, supplierId),
  ])

  const standing = verificationStanding(profile, new Date())

  const Icon =
    standing.standing === 'verified'
      ? ShieldCheck
      : standing.standing === 'rejected'
        ? ShieldAlert
        : ShieldQuestion

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Your business</h1>
        <p className="text-sand-600 mt-1 text-sm">
          What guests and the hotels you work with see about you.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your details</CardTitle>
          <CardDescription>
            Yours to change, any time. The hotel sees the same thing you do.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            profile={{
              name: profile.name,
              legalName: profile.legalName,
              description: profile.description,
              categories: profile.categories,
              contactEmail: profile.contactEmail ?? '',
              contactPhone: profile.contactPhone,
              placeId: profile.placeId,
            }}
            places={places}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Icon className="text-sand-600 size-5" aria-hidden />
            <CardTitle className="text-base">Verification</CardTitle>
            <Badge
              tone={
                standing.standing === 'verified'
                  ? 'success'
                  : standing.standing === 'rejected'
                    ? 'danger'
                    : 'warning'
              }
            >
              {standing.standing === 'verified'
                ? 'Verified by ARC'
                : standing.standing === 'rejected'
                  ? 'Not accepted'
                  : standing.standing === 'lapsed'
                    ? 'Lapsed'
                    : 'Not verified yet'}
            </Badge>
          </div>
          <CardDescription>{standing.reason}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sand-600 max-w-prose text-sm leading-relaxed">
            Only ARC can mark a business as verified, and only after a person has seen the
            documents. Everything you send here is recorded as something you have told us, and
            shown to guests as your claim, until then.
          </p>

          {standing.missingChecks.length > 0 ? (
            <div className="border-sand-200 bg-sand-50 rounded-lg border px-4 py-3">
              <p className="text-sand-800 text-sm font-medium">Still to be checked</p>
              <ul className="text-sand-600 mt-1 list-inside list-disc text-sm">
                {standing.missingChecks.map((check) => (
                  <li key={check}>{check}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <EvidenceForm
            evidence={{
              claimedCertifications: profile.claimedCertifications,
              claimedInsurer: profile.claimedInsurer,
              claimedInsurancePolicyRef: profile.claimedInsurancePolicyRef,
              claimedInsuranceExpiresOn: profile.claimedInsuranceExpiresOn
                ? toDateKey(profile.claimedInsuranceExpiresOn)
                : null,
              evidenceNotes: profile.evidenceNotes,
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
