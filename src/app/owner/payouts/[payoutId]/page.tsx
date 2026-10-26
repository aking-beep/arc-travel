import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Money } from '@/components/money'
import { isAppError } from '@/lib/errors'
import { toDateKey } from '@/lib/dates'
import { PayoutStatus, ProposalStatus } from '@/lib/prisma-types'
import { requireActor } from '@/modules/auth/service'
import { getPayout } from '@/modules/commerce/payouts'
import { CancelPayoutForm, SettlePayoutForm } from '../forms'

export const metadata = { title: 'Payout' }

/**
 * One payout: the remittance advice, and the controls for the two states it
 * can still move through.
 *
 * The page is deliberately explicit about what ARC did and did not do. Every
 * other money surface in the product describes something that happened inside
 * ARC; this one describes something that has to happen in a bank.
 */
export default async function PayoutPage({
  params,
}: {
  params: Promise<{ payoutId: string }>
}) {
  const { payoutId } = await params
  const actor = await requireActor()

  const payout = await getPayout(actor, payoutId).catch((error: unknown) => {
    // A payout id that does not exist, or belongs to another tenant, is a 404
    // either way. `getPayout` scopes by property access, so the two are
    // indistinguishable from here — which is the intention.
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) {
      notFound()
    }
    throw error
  })

  const approval = payout.proposal?.approvals[0]
  const lineTotal = payout.lines.reduce((sum, line) => sum + line.amountMinor, 0)
  const reversals = payout.lines.filter((line) => line.amountMinor < 0)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/owner/payouts"
          className="text-sand-600 text-sm underline underline-offset-4"
        >
          ← All payouts
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-display text-2xl font-semibold">{payout.reference}</h1>
          <Badge
            tone={
              payout.status === PayoutStatus.SETTLED
                ? 'success'
                : payout.status === PayoutStatus.CANCELLED
                  ? 'neutral'
                  : 'warning'
            }
          >
            {payout.status.toLowerCase()}
          </Badge>
        </div>
        <p className="text-sand-600 mt-1 text-sm">
          {payout.supplier.name} · {toDateKey(payout.periodStart)} →{' '}
          {toDateKey(payout.periodEnd)}
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Remittance advice</CardTitle>
          <p className="text-sand-600 text-sm">
            One line per ledger entry, copied at the moment the payout was computed — so this
            reproduces exactly, years later, whatever has been corrected since.
          </p>
        </CardHeader>
        <CardContent>
          <ul className="divide-sand-200 divide-y text-sm">
            {payout.lines.map((line) => (
              <li key={line.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="min-w-0 truncate">{line.description}</span>
                <Money
                  amountMinor={line.amountMinor}
                  currency={line.currency}
                  intent="neutral"
                  className={line.amountMinor < 0 ? 'text-red-800' : undefined}
                />
              </li>
            ))}
            <li className="flex items-center justify-between gap-2 py-2.5 text-base font-semibold">
              <span>Net</span>
              <Money amountMinor={payout.netMinor} currency={payout.currency} intent="neutral" />
            </li>
          </ul>

          {lineTotal !== payout.netMinor ? (
            // Should be impossible: the service writes both in one transaction
            // and a deferred constraint trigger re-checks it. Shown rather
            // than hidden, because a payout that does not add up is the one
            // number on this page nobody should have to take on trust.
            <p
              className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
              role="alert"
            >
              This payout’s lines sum to{' '}
              <Money amountMinor={lineTotal} currency={payout.currency} intent="neutral" /> but it
              declares{' '}
              <Money amountMinor={payout.netMinor} currency={payout.currency} intent="neutral" />.
              Do not pay it. That is a bug, not a rounding quirk.
            </p>
          ) : null}

          {reversals.length > 0 ? (
            <p className="text-sand-600 mt-3 text-xs">
              {reversals.length} {reversals.length === 1 ? 'line is' : 'lines are'} a reversal —
              a refunded or failed booking, deducted here rather than written off.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Who authorised this</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {approval ? (
            <p>
              <span className="font-medium">
                {approval.decidedBy.name ?? approval.decidedBy.email}
              </span>{' '}
              {approval.decision === 'APPROVED' ? 'approved' : 'rejected'} this on{' '}
              {toDateKey(approval.decidedAt)}.
              {approval.note ? <span className="text-sand-600"> “{approval.note}”</span> : null}
            </p>
          ) : (
            <p className="text-sand-600">
              Not yet approved.{' '}
              <Link
                href="/owner/approvals"
                className="text-jade-800 underline underline-offset-4"
              >
                Approve it on the approvals page
              </Link>
              , then come back here to record the payment. Nothing can be marked paid before that.
            </p>
          )}

          {payout.status === PayoutStatus.SETTLED ? (
            <p className="text-sand-700">
              Recorded as paid by{' '}
              {payout.settledBy?.name ?? payout.settledBy?.email ?? 'an owner'} on{' '}
              {payout.settledAt ? toDateKey(payout.settledAt) : '—'} ·{' '}
              {payout.settlementMethod} · ref {payout.settlementReference}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {payout.status === PayoutStatus.APPROVED ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Record the payment</CardTitle>
            <p className="text-sand-600 text-sm">
              Pay {payout.supplier.name}{' '}
              <Money amountMinor={payout.netMinor} currency={payout.currency} intent="neutral" />{' '}
              by whatever means you have agreed with them
              {payout.supplier.contactEmail ? ` (${payout.supplier.contactEmail})` : ''}, then put
              the reference here. ARC cannot send this money and cannot confirm it arrived — this
              is your record that you sent it.
            </p>
          </CardHeader>
          <CardContent>
            <SettlePayoutForm payoutId={payout.id} />
          </CardContent>
        </Card>
      ) : null}

      {payout.status === PayoutStatus.DRAFT ||
      (payout.status === PayoutStatus.APPROVED &&
        payout.proposal?.status !== ProposalStatus.EXECUTED) ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cancel</CardTitle>
            <p className="text-sand-600 text-sm">
              Releases this payout’s {payout.lines.length}{' '}
              {payout.lines.length === 1 ? 'entry' : 'entries'} so the next run picks them up. The
              payout itself is kept, cancelled, with your reason on it.
            </p>
          </CardHeader>
          <CardContent>
            <CancelPayoutForm payoutId={payout.id} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
