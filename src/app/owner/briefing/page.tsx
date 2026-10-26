import Link from 'next/link'
import { ArrowUpRight, Info, Sunrise } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Money } from '@/components/money'
import { requireActor } from '@/modules/auth/service'
import { resolveOperatingProperty } from '@/modules/hotels/service'
import { buildMorningBriefing, type BriefingSection } from '@/modules/operator/briefing'

export const metadata = { title: 'Morning briefing' }

/**
 * The morning briefing.
 *
 * Layout carries the product's main claim: earned money is at the top in its
 * own block with the query that produced it; potential value sits lower, in a
 * visually distinct card, labelled as an estimate. They are never adjacent and
 * never summed.
 */
export default async function BriefingPage() {
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)
  const briefing = await buildMorningBriefing(actor, propertyId)

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sunrise className="text-terracotta-600 size-5" aria-hidden />
            <h1 className="font-display text-2xl font-semibold">{briefing.propertyName}</h1>
          </div>
          <p className="text-sand-600 mt-1 text-sm tabular-nums">
            {briefing.forDate} · built at{' '}
            {briefing.generatedAt.toISOString().slice(11, 16)} UTC from stored records
          </p>
        </div>
        <Badge tone="demo">Demo data</Badge>
      </div>

      {briefing.narrative.length > 0 ? (
        <div className="border-jade-200 bg-jade-50/60 rounded-xl border px-4 py-3">
          {briefing.narrative.map((paragraph) => (
            <p key={paragraph} className="text-jade-900 text-sm leading-relaxed not-first:mt-1.5">
              {paragraph}
            </p>
          ))}
          <p className="text-jade-700 mt-2 text-xs">
            Prose only. Every figure below was counted from the database before this was written.
          </p>
        </div>
      ) : null}

      <section>
        <h2 className="font-display text-base font-semibold">Earned from experiences</h2>
        <p className="text-sand-600 mt-1 text-sm">
          Your share of confirmed orders, net of refunded lines. This is the number the pilot is
          judged on.
        </p>

        <div className="mt-3 grid gap-4 sm:grid-cols-4">
          {[
            { label: 'Yesterday', fact: briefing.earned.yesterdayMinor, money: true },
            { label: 'Last 7 days', fact: briefing.earned.last7DaysMinor, money: true },
            { label: 'All time', fact: briefing.earned.allTimeMinor, money: true },
            { label: 'Attach rate', fact: briefing.earned.attachRatePct, money: false },
          ].map((entry) => (
            <Card key={entry.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sand-600 text-xs font-medium tracking-wide uppercase">
                  {entry.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-semibold">
                  {entry.money ? (
                    <Money
                      amountMinor={entry.fact.value}
                      currency={briefing.currency}
                      intent="earned"
                    />
                  ) : (
                    <span className="tabular-nums">{entry.fact.value}%</span>
                  )}
                </p>
                <p className="text-sand-500 mt-1.5 text-xs leading-snug">{entry.fact.derivation}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <BriefingSectionBlock section={briefing.arrivals} currency={briefing.currency} />
      <BriefingSectionBlock section={briefing.departuresToday} currency={briefing.currency} />

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-base font-semibold">{briefing.opportunities.title}</h2>
          {briefing.potential.totalMinor > 0 ? (
            <p className="text-sand-600 text-sm">
              Potential{' '}
              <Money
                amountMinor={briefing.potential.totalMinor}
                currency={briefing.currency}
                intent="potential"
                className="font-semibold"
              />
            </p>
          ) : null}
        </div>
        <div className="border-sand-300 bg-sand-100/60 mt-2 rounded-xl border border-dashed px-4 py-3">
          <p className="text-sand-700 flex items-start gap-2 text-xs leading-relaxed">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {briefing.potential.note}
          </p>
        </div>
        <p className="text-sand-600 mt-3 text-sm">{briefing.opportunities.summary}</p>
        <SectionList section={briefing.opportunities} currency={briefing.currency} potential />
      </section>

      <BriefingSectionBlock section={briefing.gaps} currency={briefing.currency} />

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-base font-semibold">{briefing.approvals.title}</h2>
          {briefing.approvals.items.length > 0 ? (
            <LinkButton href="/owner/approvals" size="sm" variant="outline">
              Review
            </LinkButton>
          ) : null}
        </div>
        <p className="text-sand-600 mt-1 text-sm">{briefing.approvals.summary}</p>
        <SectionList section={briefing.approvals} currency={briefing.currency} potential />
      </section>

      <p className="text-sand-500 border-sand-200 border-t pt-5 text-xs leading-relaxed">
        ARC does not act on your behalf. Drafted actions wait for your approval, outbound guest
        messaging is disabled in this build, and no payout is ever initiated. All money shown is
        simulated.
      </p>
    </div>
  )
}

function BriefingSectionBlock({
  section,
  currency,
}: {
  section: BriefingSection
  currency: string
}) {
  return (
    <section>
      <h2 className="font-display text-base font-semibold">{section.title}</h2>
      <p className="text-sand-600 mt-1 text-sm">{section.summary}</p>
      <SectionList section={section} currency={currency} />
    </section>
  )
}

function SectionList({
  section,
  currency,
  potential = false,
}: {
  section: BriefingSection
  currency: string
  potential?: boolean
}) {
  if (section.items.length === 0) return null

  return (
    <ul className="divide-sand-200 mt-3 divide-y">
      {section.items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {item.href ? (
                <Link href={item.href} className="hover:text-jade-800 inline-flex items-center gap-1">
                  {item.label}
                  <ArrowUpRight className="size-3 opacity-50" aria-hidden />
                </Link>
              ) : (
                item.label
              )}
            </p>
            {item.detail ? <p className="text-sand-500 text-xs">{item.detail}</p> : null}
          </div>
          {potential && item.potentialValueMinor ? (
            <Money
              amountMinor={item.potentialValueMinor}
              currency={currency}
              intent="potential"
              className="text-sm"
            />
          ) : null}
        </li>
      ))}
    </ul>
  )
}
