import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { requireActor } from '@/modules/auth/service'
import { getVerificationQueue } from '@/modules/admin/service'
import { getSourceChangeQueue } from '@/modules/culture-context/snapshots'
import { VerificationStatus } from '@/lib/prisma-types'
import { toDateKey } from '@/lib/dates'
import { ReviewSourceChangeForm, VerifyPropertyForm, VerifySupplierForm } from './forms'

export const metadata = { title: 'Verification' }

const TONE = {
  [VerificationStatus.VERIFIED]: 'success',
  [VerificationStatus.PENDING]: 'warning',
  [VerificationStatus.UNVERIFIED]: 'neutral',
  [VerificationStatus.REJECTED]: 'danger',
} as const

export default async function AdminVerificationPage() {
  const actor = await requireActor()
  const [queue, sourceChanges] = await Promise.all([
    getVerificationQueue(actor),
    getSourceChangeQueue(actor),
  ])
  const pendingChanges = sourceChanges.filter((c) => c.verification === VerificationStatus.PENDING)

  const unverified = queue.suppliers.filter(
    (s) => s.verification !== VerificationStatus.VERIFIED,
  )

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Verification</h1>
        <p className="text-sand-600 mt-1 max-w-prose text-sm leading-relaxed">
          This page is the only route to a verified status anywhere in ARC. Nothing is verified by a
          seed, by an owner adding a partner, or by a partner’s own claims. {unverified.length} of{' '}
          {queue.suppliers.length} partners are not yet verified.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="font-display text-base font-semibold">Partners</h2>
        {queue.suppliers.map((supplier) => (
          <Card key={supplier.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{supplier.name}</CardTitle>
                  <p className="text-sand-500 text-xs">
                    {supplier.organizationName} · added {toDateKey(supplier.createdAt)}
                  </p>
                </div>
                <Badge tone={TONE[supplier.verification]}>
                  {supplier.verification.toLowerCase()}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <dl className="text-sand-700 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-sand-500 text-xs">Experiences</dt>
                  <dd className="font-medium tabular-nums">
                    {supplier.publishedCount} live of {supplier.experienceCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-sand-500 text-xs">Insurance</dt>
                  <dd className="font-medium">
                    {supplier.insuranceOnFile ? 'On file' : 'Not on file'}
                  </dd>
                </div>
                <div>
                  <dt className="text-sand-500 text-xs">Contact</dt>
                  <dd className="truncate font-mono text-xs">{supplier.contactEmail ?? '—'}</dd>
                </div>
              </dl>

              {supplier.claimedCertifications.length > 0 ? (
                <div className="bg-sand-100 rounded-xl px-4 py-3">
                  <p className="text-sand-700 text-xs font-medium uppercase">
                    Claimed, not confirmed
                  </p>
                  <ul className="text-sand-600 mt-1.5 space-y-0.5 text-sm">
                    {supplier.claimedCertifications.map((cert) => (
                      <li key={cert}>· {cert}</li>
                    ))}
                  </ul>
                  <p className="text-sand-500 mt-2 text-xs">
                    These are the partner’s own statements. Verifying means you have seen the
                    documents behind them.
                  </p>
                </div>
              ) : null}

              {supplier.publishedCount > 0 &&
              supplier.verification !== VerificationStatus.VERIFIED ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {supplier.publishedCount} live{' '}
                  {supplier.publishedCount === 1 ? 'experience is' : 'experiences are'} already
                  selling from this unverified partner. Guests see a notice, but this should be zero
                  before a real pilot.
                </p>
              ) : null}

              {supplier.standing.standing === 'lapsed' ? (
                /*
                 * The case this whole change exists for: a decision that was
                 * correct when it was made and is not current now. Not shown as
                 * a failure of the admin who made it, and not quietly treated
                 * as still true either.
                 */
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-900" role="alert">
                  Verification has lapsed. {supplier.standing.reason} Guests are no longer shown a
                  verified badge for this partner.
                </p>
              ) : supplier.daysUntilInsuranceExpiry !== null &&
                supplier.daysUntilInsuranceExpiry <= 30 ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  The insurance on file expires in {supplier.daysUntilInsuranceExpiry}{' '}
                  {supplier.daysUntilInsuranceExpiry === 1 ? 'day' : 'days'} (
                  {supplier.insuranceExpiresOn}). Ask for the renewal now; the verification lapses
                  on that date.
                </p>
              ) : null}

              <VerifySupplierForm
                supplierId={supplier.id}
                verifiedChecks={supplier.verifiedChecks}
                insuranceExpiresOn={supplier.insuranceExpiresOn}
              />
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="font-display text-base font-semibold">Travel-advice changes</h2>
          <p className="text-sand-600 mt-1 max-w-prose text-sm leading-relaxed">
            A new content hash means the source&rsquo;s text changed. It does not mean the rules
            changed. Guests are told the advice was updated only after you verify the change here.{' '}
            {pendingChanges.length} waiting for review.
          </p>
        </div>
        {sourceChanges.length === 0 ? (
          <p className="border-sand-300 text-sand-600 rounded-xl border border-dashed px-4 py-6 text-center text-sm">
            No changes detected. Each check of a source is recorded on the health page.
          </p>
        ) : (
          sourceChanges.map((change) => (
            <Card key={change.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="font-mono text-sm">{change.sourceKey}</CardTitle>
                    <p className="text-sand-500 text-xs">
                      detected {change.detectedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC ·
                      sections: {change.changedSections.join(', ') || 'none named'}
                      {change.currentIsFixture ? ' · fixture data' : ''}
                    </p>
                  </div>
                  <Badge tone={TONE[change.verification]}>{change.verification.toLowerCase()}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="text-sand-700 grid gap-3 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-sand-500">Previous</dt>
                    <dd className="font-mono">
                      {change.previousHash.slice(0, 12)} · {toDateKey(change.previousRetrievedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sand-500">Current</dt>
                    <dd className="font-mono">
                      {change.currentHash.slice(0, 12)} · {toDateKey(change.currentRetrievedAt)}
                    </dd>
                  </div>
                </dl>
                <a
                  href={change.sourceUrl}
                  className="text-jade-800 text-xs underline"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Open the source to compare
                </a>
                {change.reviewedAt ? (
                  <p className="text-sand-600 text-xs">
                    Reviewed by {change.reviewedByName ?? 'a removed user'} on{' '}
                    {toDateKey(change.reviewedAt)}: {change.reviewNote}
                  </p>
                ) : null}
                <ReviewSourceChangeForm changeId={change.id} />
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-base font-semibold">Properties</h2>
        {queue.properties.map((property) => (
          <Card key={property.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{property.name}</CardTitle>
                  <p className="text-sand-500 text-xs">
                    {property.organizationName} · {property.roomCount} rooms ·{' '}
                    {property.experienceCount} experiences
                  </p>
                </div>
                <Badge tone={TONE[property.verification]}>
                  {property.verification.toLowerCase()}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <VerifyPropertyForm propertyId={property.id} />
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  )
}
