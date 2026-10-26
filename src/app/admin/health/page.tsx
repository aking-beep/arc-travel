import { AlertOctagon, CheckCircle2, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { requireActor } from '@/modules/auth/service'
import { runQualityChecks } from '@/modules/admin/service'
import { getEventSummary } from '@/modules/analytics/reports'
import { getEnv } from '@/lib/env'
import { prisma } from '@/lib/db'
import { listAuditTrail } from '@/modules/workflows/audit'
import { getSourceHealth } from '@/modules/culture-context/snapshots'
import { RefreshTravelAdviceForm } from '../forms'

export const metadata = { title: 'System health' }

const LEVEL = {
  ok: { tone: 'success', Icon: CheckCircle2 },
  warn: { tone: 'warning', Icon: TriangleAlert },
  fail: { tone: 'danger', Icon: AlertOctagon },
} as const

/**
 * System health.
 *
 * Checks, not a score. Each row is a concrete claim about the data that an
 * admin can read and act on, and the two that matter most — no oversold
 * departure, every order's split reconciling — are failures rather than
 * warnings because either one means the product is lying about something.
 */
export default async function HealthPage() {
  const actor = await requireActor()
  const env = getEnv()

  /*
   * Three states, and the difference matters to whoever is reading this
   * page. While ARC_DATA_MODE=demo the sign-in switcher issues an owner
   * session with no credential (ADR-028) and the seeded guest portals are
   * reachable by token, so "open" means a stranger with the URL can act as
   * the hotel.
   */
  const frontDoor = (process.env.ARC_DEMO_PASSPHRASE ?? '').length > 0
    ? 'passphrase required'
    : env.ARC_ALLOW_OPEN_DEMO
      ? 'OPEN — deliberately (ARC_ALLOW_OPEN_DEMO)'
      : 'open — no passphrase set'

  const organization = await prisma.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  })

  const [checks, events, audit, sources] = await Promise.all([
    runQualityChecks(actor),
    organization ? getEventSummary(organization.id) : Promise.resolve(null),
    organization ? listAuditTrail(organization.id, { limit: 25 }) : Promise.resolve([]),
    getSourceHealth(actor),
  ])

  const failures = checks.filter((c) => c.level === 'fail')
  const totalAiCost = (events?.agentRuns ?? []).reduce((n, r) => n + r.costMicroUsd, 0)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">System health</h1>
        <p className="text-sand-600 mt-1 text-sm">
          {failures.length === 0
            ? 'No correctness failures.'
            : `${failures.length} correctness ${failures.length === 1 ? 'failure' : 'failures'}. These are bugs, not warnings.`}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data quality</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-sand-200 divide-y">
            {checks.map((check) => {
              const { tone, Icon } = LEVEL[check.level]
              return (
                <li key={check.key} className="flex items-start gap-3 py-3">
                  <Icon
                    className={
                      check.level === 'ok'
                        ? 'mt-0.5 size-4 shrink-0 text-emerald-600'
                        : check.level === 'warn'
                          ? 'mt-0.5 size-4 shrink-0 text-amber-600'
                          : 'mt-0.5 size-4 shrink-0 text-red-600'
                    }
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{check.label}</p>
                    <p className="text-sand-600 text-sm">{check.detail}</p>
                  </div>
                  <Badge tone={tone}>{check.level}</Badge>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Travel-advice sources</CardTitle>
          <p className="text-sand-600 text-sm">
            Every check is recorded, failed ones too. A guest brief built while a source is down
            says so instead of showing anything.
          </p>
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <p className="text-sand-600 text-sm">No sources configured.</p>
          ) : (
            <ul className="divide-sand-200 divide-y">
              {sources.map((source) => (
                <li key={source.sourceKey} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-sm">{source.sourceKey}</p>
                      <p className="text-sand-500 text-xs">
                        {source.authority} · {source.destination}
                      </p>
                    </div>
                    <Badge
                      tone={
                        source.lastCheckOk === null
                          ? 'neutral'
                          : source.lastCheckOk
                            ? 'success'
                            : 'danger'
                      }
                    >
                      {source.lastCheckOk === null
                        ? 'never checked'
                        : source.lastCheckOk
                          ? 'last check ok'
                          : `failing: ${source.lastFailureReason}`}
                    </Badge>
                  </div>
                  <dl className="text-sand-700 grid gap-2 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-sand-500">Content retrieved</dt>
                      <dd className="tabular-nums">
                        {source.lastSuccessRetrievedAt
                          ? source.lastSuccessRetrievedAt.toISOString().slice(0, 16).replace('T', ' ')
                          : '—'}
                        {source.lastSuccessIsFixture ? ' (fixture)' : ''}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sand-500">Last checked</dt>
                      <dd className="tabular-nums">
                        {source.lastCheckedAt
                          ? source.lastCheckedAt.toISOString().slice(0, 16).replace('T', ' ')
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sand-500">Failures since last success</dt>
                      <dd className="tabular-nums">
                        {source.failuresSinceSuccess} of {source.checks} checks
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sand-500">Changes awaiting review</dt>
                      <dd className="tabular-nums">{source.pendingChanges}</dd>
                    </div>
                  </dl>
                  <RefreshTravelAdviceForm destination={source.destination} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-sand-200 divide-y text-sm">
              {[
                { label: 'Data mode', value: env.ARC_DATA_MODE },
                { label: 'Payments', value: env.PAYMENTS_PROVIDER },
                { label: 'AI provider', value: `${env.AI_PROVIDER} (${env.AI_MODEL})` },
                /*
                 * Each of these has one possible value, which is the point.
                 * They are still shown: an operator checking whether live
                 * marine data is gating recommendations needs to see the answer
                 * here, and "fixture" is the answer.
                 */
                { label: 'Maps', value: `${env.MAPS_PROVIDER} (seeded matrix, ADR-011)` },
                { label: 'Conditions', value: `${env.CONDITIONS_PROVIDER} (seeded reports)` },
                { label: 'Messaging', value: `${env.MESSAGING_PROVIDER} (refuses to deliver)` },
                { label: 'Travel advice', value: env.TRAVEL_ADVICE_PROVIDER },
                {
                  label: 'Outbound guest messaging',
                  value: env.ARC_ENABLE_OUTBOUND_MESSAGING ? 'ENABLED' : 'disabled',
                },
                { label: 'AI rate limit', value: `${env.AI_RATE_LIMIT_PER_MINUTE}/min per user` },
                /*
                 * Who can get in. Shown because the answer used to be
                 * unknowable from inside the product: the passphrase gate is
                 * opt-in, so a deployment that never set one was open and said
                 * nothing anywhere. In production that is now a startup
                 * refusal unless it was asked for; here it is simply visible.
                 */
                {
                  label: 'Front door',
                  value: frontDoor,
                },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3 py-2">
                  <dt className="text-sand-600">{row.label}</dt>
                  <dd className="font-mono text-xs">{row.value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sand-500 mt-3 text-xs leading-relaxed">
              Demo mode refuses to start with a live payment provider, and outbound messaging is a
              hard kill switch rather than a feature flag.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI usage (7 days)</CardTitle>
            <p className="text-sand-600 text-sm">
              Every call is recorded, including the ones that were blocked.
            </p>
          </CardHeader>
          <CardContent>
            {!events || events.agentRuns.length === 0 ? (
              <p className="text-sand-600 text-sm">No calls recorded.</p>
            ) : (
              <>
                <ul className="divide-sand-200 divide-y text-sm">
                  {events.agentRuns.map((run) => (
                    <li
                      key={`${run.task}-${run.status}`}
                      className="flex items-center justify-between gap-2 py-2"
                    >
                      <span className="min-w-0">
                        <span className="font-mono text-xs">{run.task}</span>
                        <Badge
                          tone={
                            run.status === 'SUCCEEDED'
                              ? 'success'
                              : run.status === 'BLOCKED'
                                ? 'warning'
                                : 'danger'
                          }
                          className="ml-2"
                        >
                          {run.status.toLowerCase()}
                        </Badge>
                      </span>
                      <span className="text-sand-500 shrink-0 text-xs tabular-nums">
                        {run.count} × · {run.inputTokens + run.outputTokens} tok
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-sand-500 mt-3 text-xs">
                  Estimated spend: ${(totalAiCost / 1_000_000).toFixed(4)} USD. Zero while the mock
                  provider is in use.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {events && events.events.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Product events (7 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-sand-200 divide-y text-sm">
              {events.events.slice(0, 15).map((event) => (
                <li
                  key={`${event.name}-${event.surface}`}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <span>
                    <span className="font-mono text-xs">{event.name}</span>
                    <span className="text-sand-500 ml-2 text-xs">{event.surface}</span>
                  </span>
                  <span className="tabular-nums">{event.count}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent audit trail</CardTitle>
          <p className="text-sand-600 text-sm">
            Append-only. PII is redacted before it is written.
          </p>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="text-sand-600 text-sm">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-sand-200 divide-y text-sm">
              {audit.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="font-mono text-xs">{event.action}</span>
                    <span className="text-sand-500 ml-2 text-xs">
                      {event.entityType}
                      {event.actor ? ` · ${event.actor.name}` : ` · ${event.actorKind}`}
                    </span>
                  </span>
                  <span className="text-sand-400 shrink-0 text-xs tabular-nums">
                    {event.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
