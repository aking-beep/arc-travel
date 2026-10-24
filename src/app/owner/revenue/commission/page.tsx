import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { Money } from '@/components/money'
import { getLocale } from '@/lib/i18n/server'
import { CommissionBasis } from '@/lib/prisma-types'
import { requireActor } from '@/modules/auth/service'
import { getCommissionOverview } from '@/modules/commerce/commission-admin'
import { resolveOperatingProperty } from '@/modules/hotels/service'
import { CommissionDefaultsForm, CommissionRuleForm, ToggleRuleForm } from './forms'

export const metadata = { title: 'Commission' }

/**
 * Commission administration.
 *
 * Every figure on this page comes from `resolveCommission` and
 * `splitEarnings` — the same functions checkout uses — so what an owner sees
 * here is what the ledger will record. A display-only calculation would
 * eventually disagree with the one that pays people.
 *
 * The three shares are shown with `intent="earned"` for the hotel's own share
 * of a real price and `intent="neutral"` for the others: this is a split of a
 * list price, not revenue already taken, and ADR-007 forbids presenting those
 * as the same kind of number.
 */
const scopeOf = (rule: {
  experienceId: string | null
  category: string | null
  propertyId: string | null
  experienceTitle: string | null
}): string => {
  if (rule.experienceId) return rule.experienceTitle ?? 'One experience'
  if (rule.category) return `Category: ${rule.category}`
  if (rule.propertyId) return 'This property'
  return 'Whole business'
}

export default async function CommissionPage() {
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)
  const [overview, locale] = await Promise.all([
    getCommissionOverview(actor, propertyId),
    getLocale(),
  ])

  const share = (rule: { basis: CommissionBasis; hotelShare: number; platformShare: number }) =>
    rule.basis === CommissionBasis.PERCENT_OF_GROSS
      ? `${(rule.hotelShare / 100).toFixed(1)}% / ${(rule.platformShare / 100).toFixed(1)}%`
      : `${(rule.hotelShare / 100).toFixed(2)} / ${(rule.platformShare / 100).toFixed(2)} per person`

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <Link href="/owner/revenue" className="text-jade-800 text-sm underline underline-offset-4">
          ← Back to revenue
        </Link>
        <h1 className="font-display mt-2 text-2xl font-semibold">Commission</h1>
        <p className="text-sand-600 mt-1 max-w-prose text-sm">
          Who gets what from each experience sold. The most specific rule wins: one experience
          beats a category, a category beats the property, and the property beats your default.
          The partner always takes the remainder.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your default split</CardTitle>
          <p className="text-sand-600 text-sm">
            What applies when no rule below matches a sale.
          </p>
        </CardHeader>
        <CardContent>
          <CommissionDefaultsForm
            hotelBps={overview.defaults.hotelBps}
            platformBps={overview.defaults.platformBps}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What a sale would split today</CardTitle>
          <p className="text-sand-600 text-sm">
            One unit of each published experience at its current price, resolved by the same code
            the checkout runs. These are splits of a list price, not revenue taken.
          </p>
        </CardHeader>
        <CardContent>
          {overview.preview.length === 0 ? (
            <EmptyState
              title="Nothing published yet"
              description="Publish an experience and its split will appear here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-sand-500 border-sand-200 border-b text-left text-xs">
                    <th className="py-2 pr-3 font-medium">Experience</th>
                    <th className="py-2 pr-3 font-medium">Price</th>
                    <th className="py-2 pr-3 font-medium">You</th>
                    <th className="py-2 pr-3 font-medium">ARC</th>
                    <th className="py-2 pr-3 font-medium">Partner</th>
                    <th className="py-2 font-medium">Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.preview.map((row) => (
                    <tr key={row.experienceId} className="border-sand-100 border-b">
                      <td className="py-2 pr-3">{row.title}</td>
                      <td className="py-2 pr-3">
                        <Money
                          amountMinor={row.unitPriceMinor}
                          currency={row.currency}
                          locale={locale}
                          intent="neutral"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Money
                          amountMinor={row.hotelMinor}
                          currency={row.currency}
                          locale={locale}
                          intent="neutral"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Money
                          amountMinor={row.platformMinor}
                          currency={row.currency}
                          locale={locale}
                          intent="neutral"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Money
                          amountMinor={row.supplierMinor}
                          currency={row.currency}
                          locale={locale}
                          intent="neutral"
                        />
                      </td>
                      <td className="py-2">
                        <Badge tone="neutral">{row.resolved.specificity}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rules</CardTitle>
          <p className="text-sand-600 text-sm">
            {overview.rules.filter((r) => r.isActive).length} active of {overview.rules.length}.
            A rule is deactivated rather than deleted, because a past order’s ledger names the rule
            that produced its split.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {overview.rules.length === 0 ? (
            <EmptyState
              title="No rules yet"
              description="Every sale resolves against your default split above."
            />
          ) : (
            overview.rules.map((rule) => (
              <div
                key={rule.id}
                className="border-sand-200 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {scopeOf(rule)}
                    {rule.isActive ? null : <Badge tone="warning">Inactive</Badge>}
                    {rule.priority > 0 ? (
                      <Badge tone="neutral">priority {rule.priority}</Badge>
                    ) : null}
                  </p>
                  <p className="text-sand-600 text-sm tabular-nums">{share(rule)}</p>
                  {rule.note ? <p className="text-sand-500 text-xs">{rule.note}</p> : null}
                </div>
                <ToggleRuleForm ruleId={rule.id} isActive={rule.isActive} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a rule</CardTitle>
          <p className="text-sand-600 text-sm">
            It applies to new bookings immediately. Orders already placed keep the split they were
            recorded with.
          </p>
        </CardHeader>
        <CardContent>
          <CommissionRuleForm
            experiences={overview.preview.map((row) => ({ id: row.experienceId, title: row.title }))}
          />
        </CardContent>
      </Card>
    </div>
  )
}
