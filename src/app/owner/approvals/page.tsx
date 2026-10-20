import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { Money } from '@/components/money'
import { requireActor } from '@/modules/auth/service'
import { resolveOperatingProperty } from '@/modules/hotels/service'
import { listProposals } from '@/modules/workflows/proposals'
import { ProposalStatus } from '@/lib/prisma-types'
import { DecisionForm } from './forms'

export const metadata = { title: 'Approvals' }

const STATUS_TONE = {
  [ProposalStatus.PENDING_APPROVAL]: 'warning',
  [ProposalStatus.APPROVED]: 'brand',
  [ProposalStatus.EXECUTED]: 'success',
  [ProposalStatus.REJECTED]: 'neutral',
  [ProposalStatus.EXPIRED]: 'neutral',
  [ProposalStatus.DRAFT]: 'neutral',
} as const

export default async function ApprovalsPage() {
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)
  const proposals = await listProposals(actor, propertyId)

  const pending = proposals.filter((p) => p.status === ProposalStatus.PENDING_APPROVAL)
  const decided = proposals.filter((p) => p.status !== ProposalStatus.PENDING_APPROVAL)

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Approvals</h1>
        <p className="text-sand-600 mt-1 text-sm">
          ARC drafts actions and shows the facts behind them. Nothing happens until you say so, and
          every decision is recorded with your name against it.
        </p>
      </div>

      {pending.length === 0 ? (
        <EmptyState
          title="Nothing waiting on you"
          description="Drafted actions appear here as ARC spots them in your data."
        />
      ) : (
        <div className="space-y-4">
          {pending.map((proposal) => {
            const evidence = (proposal.evidenceJson ?? {}) as Record<string, unknown>
            const action = (proposal.actionJson ?? {}) as { type?: string }

            return (
              <Card key={proposal.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle className="text-base">{proposal.title}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">{proposal.kind.replace(/_/g, ' ').toLowerCase()}</Badge>
                      <Badge tone={STATUS_TONE[proposal.status]}>Awaiting you</Badge>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <p className="text-sand-700 text-sm leading-relaxed">{proposal.summary}</p>

                  {proposal.potentialValueMinor > 0 ? (
                    <p className="text-sand-600 text-sm">
                      Potential value{' '}
                      <Money
                        amountMinor={proposal.potentialValueMinor}
                        currency={proposal.currency}
                        intent="potential"
                        className="font-medium"
                      />{' '}
                      <span className="text-sand-500 text-xs">
                        — an estimate, not revenue you have earned.
                      </span>
                    </p>
                  ) : null}

                  <details className="border-sand-200 rounded-xl border px-4 py-3">
                    <summary className="text-sand-700 cursor-pointer text-sm font-medium">
                      What this is based on
                    </summary>
                    <dl className="text-sand-600 mt-2 space-y-1 text-xs">
                      {Object.entries(evidence).map(([key, value]) => (
                        <div key={key} className="flex gap-2">
                          <dt className="text-sand-500 font-mono">{key}</dt>
                          <dd>{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="text-sand-500 mt-2.5 font-mono text-xs">
                      On approval: {action.type ?? 'unknown'}
                    </p>
                    {proposal.agentRun ? (
                      <p className="text-sand-400 mt-1 text-xs">
                        Drafted with {proposal.agentRun.model} ({proposal.agentRun.provider}).
                      </p>
                    ) : (
                      <p className="text-sand-400 mt-1 text-xs">
                        Drafted from database facts with no model involved.
                      </p>
                    )}
                  </details>

                  <DecisionForm proposalId={proposal.id} />
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {decided.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Decided</CardTitle>
            <p className="text-sand-600 text-sm">
              The record of what was approved, by whom, and what it did.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="divide-sand-200 divide-y text-sm">
              {decided.map((proposal) => {
                const latest = proposal.approvals[0]
                const execution = proposal.executionResultJson as { summary?: string } | null
                return (
                  <li key={proposal.id} className="space-y-1 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{proposal.title}</p>
                      <Badge tone={STATUS_TONE[proposal.status]}>
                        {proposal.status.toLowerCase().replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    {latest ? (
                      <p className="text-sand-500 text-xs">
                        {latest.decision.toLowerCase()} by {latest.decidedBy.name} on{' '}
                        {latest.decidedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC
                        {latest.note ? ` — “${latest.note}”` : ''}
                      </p>
                    ) : null}
                    {execution?.summary ? (
                      <p className="text-sand-600 text-xs">{execution.summary}</p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
