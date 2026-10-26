import { prisma, type Prisma } from '@/lib/db'
import { isSerializationFailure } from '@/lib/serialization'
import { conflict, invalid, notFound } from '@/lib/errors'
import { SourceClass, VerificationStatus } from '@/lib/prisma-types'
import { getIntegrations } from '@/modules/integrations/defaults'
import { govukPublicUrl } from '@/modules/integrations/govuk'
import {
  providerFailed,
  type ProviderResult,
  type TravelAdviceDocument,
  type TravelAdviceProvider,
} from '@/modules/integrations/types'
import { assertPlatformAdmin, type ActorContext } from '@/modules/tenancy/context'
import { recordAudit } from '@/modules/workflows/audit'
import { countryForDestination, DESTINATION_COUNTRIES } from './destinations'
import {
  changedSections,
  GOVUK_AUTHORITY,
  govukSourceKey,
  parseGovUkAdvice,
  type GovUkSnapshotContent,
} from './govuk'
import { hashesDiffer } from './hash'
import { reviewSourceChangeSchema, type ReviewSourceChangeInput } from './schemas'

/**
 * Source snapshots and change review.
 *
 * Every check of a source is appended as a `CultureSourceSnapshot`, the failed
 * ones too. When a successful check's hash differs from the previous
 * successful one, a `CultureSourceChange` opens in the admin verification
 * queue as PENDING.
 *
 * The review reuses the machinery that makes "verified" mean something
 * elsewhere in ARC: `assertPlatformAdmin`, a mandatory note, a named reviewer
 * and `recordAudit` in the same transaction. Until a change is VERIFIED,
 * nothing derived from it reaches a guest: `getPublishedChangeNotice` reads
 * VERIFIED changes only, and it is the only thing the guest surface reads
 * here.
 */

export type SourceCheckOutcome = 'baseline' | 'unchanged' | 'changed' | 'unavailable'

export interface SourceCheckResult {
  sourceKey: string
  snapshotId: string
  outcome: SourceCheckOutcome
  changeId: string | null
  contentHash: string | null
  failureReason: string | null
}


/**
 * Checks the travel-advice source for one destination and records the result.
 *
 * Internal: called by the admin action (`refreshTravelAdvice`) and the seed,
 * neither of which is a guest. `now` is the snapshot's `createdAt` as well as
 * its fallback retrieval time, so ordering is the caller's clock, not the
 * database's.
 */
export async function checkTravelAdviceSource(options: {
  destination: string
  provider?: TravelAdviceProvider
  now?: Date
  /** Runs in the same transaction as the snapshot, so a check and its audit cannot diverge. */
  record?: (tx: Prisma.TransactionClient, result: SourceCheckResult) => Promise<void>
}): Promise<SourceCheckResult> {
  const country = countryForDestination(options.destination)
  if (!country) throw invalid(`No travel-advice source covers "${options.destination}".`)

  const provider = options.provider ?? getIntegrations().travelAdvice
  const now = options.now ?? new Date()
  const slug = country.govukSlug
  const sourceKey = govukSourceKey(slug)

  let result: ProviderResult<TravelAdviceDocument>
  try {
    result = await provider.getAdvice({ slug })
  } catch {
    result = providerFailed(provider.name, 'provider_threw')
  }

  const base = {
    sourceKey,
    authority: GOVUK_AUTHORITY,
    sourceClass: SourceClass.GOVERNMENT_ADVISORY,
    jurisdiction: country.countryCode,
    provider: result.provider,
    createdAt: now,
  }

  const parsed = result.ok && result.data ? parseGovUkAdvice(result.data, country.countryCode) : null
  const failureReason = !result.ok || !result.data
    ? (result.reason ?? 'unknown')
    : parsed && parsed.rules.length === 0
      ? 'no_expected_sections'
      : null

  if (failureReason || !parsed || !result.data) {
    return prisma.$transaction(async (tx) => {
      const snapshot = await tx.cultureSourceSnapshot.create({
        data: {
          ...base,
          sourceUrl: result.data?.sourceUrl ?? govukPublicUrl(slug),
          isFixture: result.data?.isFixture ?? false,
          ok: false,
          failureReason: failureReason ?? 'unknown',
          retrievedAt: result.data?.retrievedAt ?? now,
        },
        select: { id: true },
      })
      const failed: SourceCheckResult = {
        sourceKey,
        snapshotId: snapshot.id,
        outcome: 'unavailable',
        changeId: null,
        contentHash: null,
        failureReason: failureReason ?? 'unknown',
      }
      await options.record?.(tx, failed)
      return failed
    })
  }

  const document = result.data
  try {
    return await prisma.$transaction(
      async (tx) => {
        const checked: SourceCheckResult = await (async () => {
          // Read inside the transaction what we compare against.
          const previous = await tx.cultureSourceSnapshot.findFirst({
            where: { sourceKey, ok: true },
            orderBy: { createdAt: 'desc' },
            select: { id: true, contentHash: true, contentJson: true },
          })

          const snapshot = await tx.cultureSourceSnapshot.create({
            data: {
              ...base,
              sourceUrl: document.sourceUrl,
              isFixture: document.isFixture,
              ok: true,
              contentHash: parsed.contentHash,
              contentJson: parsed.content as unknown as Prisma.InputJsonValue,
              retrievedAt: document.retrievedAt,
            },
            select: { id: true },
          })

          if (!previous?.contentHash) {
            return {
              sourceKey,
              snapshotId: snapshot.id,
              outcome: 'baseline' as const,
              changeId: null,
              contentHash: parsed.contentHash,
              failureReason: null,
            }
          }

          if (!hashesDiffer(previous.contentHash, parsed.contentHash)) {
            return {
              sourceKey,
              snapshotId: snapshot.id,
              outcome: 'unchanged' as const,
              changeId: null,
              contentHash: parsed.contentHash,
              failureReason: null,
            }
          }

          const change = await tx.cultureSourceChange.create({
            data: {
              sourceKey,
              previousSnapshotId: previous.id,
              currentSnapshotId: snapshot.id,
              previousHash: previous.contentHash,
              currentHash: parsed.contentHash,
              changedSections: changedSections(
                previous.contentJson as unknown as GovUkSnapshotContent | null,
                parsed.content,
              ),
              // Detection only. A person decides what it means.
              verification: VerificationStatus.PENDING,
            },
            select: { id: true },
          })

          return {
            sourceKey,
            snapshotId: snapshot.id,
            outcome: 'changed' as const,
            changeId: change.id,
            contentHash: parsed.contentHash,
            failureReason: null,
          }
        })()
        await options.record?.(tx, checked)
        return checked
      },
      { isolationLevel: 'Serializable', timeout: 15_000 },
    )
  } catch (error) {
    if (isSerializationFailure(error)) {
      throw conflict('Another check of this source is running. Try again in a moment.')
    }
    throw error
  }
}

/** The admin action: check a source now. Platform-scoped, so audited without a tenant. */
export async function refreshTravelAdvice(
  actor: ActorContext,
  options: { destination: string; provider?: TravelAdviceProvider; now?: Date },
): Promise<SourceCheckResult> {
  assertPlatformAdmin(actor)
  return checkTravelAdviceSource({
    ...options,
    record: (tx, result) =>
      recordAudit(
        {
          organizationId: null,
          actor,
          actorKind: 'admin',
          action: 'admin.culture.source.check',
          entityType: 'CultureSourceSnapshot',
          entityId: result.snapshotId,
          metadata: {
            sourceKey: result.sourceKey,
            outcome: result.outcome,
            changeId: result.changeId,
            failureReason: result.failureReason,
          },
        },
        tx,
      ),
  })
}

export interface SourceChangeQueueItem {
  id: string
  sourceKey: string
  verification: VerificationStatus
  changedSections: string[]
  previousHash: string
  currentHash: string
  detectedAt: Date
  previousRetrievedAt: Date
  currentRetrievedAt: Date
  currentIsFixture: boolean
  sourceUrl: string
  reviewedByName: string | null
  reviewedAt: Date | null
  reviewNote: string | null
}

export async function getSourceChangeQueue(actor: ActorContext): Promise<SourceChangeQueueItem[]> {
  assertPlatformAdmin(actor)
  const changes = await prisma.cultureSourceChange.findMany({
    // PENDING sorts before VERIFIED and REJECTED in the enum.
    orderBy: [{ verification: 'asc' }, { detectedAt: 'desc' }],
    take: 50,
    select: {
      id: true,
      sourceKey: true,
      verification: true,
      changedSections: true,
      previousHash: true,
      currentHash: true,
      detectedAt: true,
      reviewedAt: true,
      reviewNote: true,
      reviewedBy: { select: { name: true } },
      previous: { select: { retrievedAt: true } },
      current: { select: { retrievedAt: true, isFixture: true, sourceUrl: true } },
    },
  })
  return changes.map((c) => ({
    id: c.id,
    sourceKey: c.sourceKey,
    verification: c.verification,
    changedSections: c.changedSections,
    previousHash: c.previousHash,
    currentHash: c.currentHash,
    detectedAt: c.detectedAt,
    previousRetrievedAt: c.previous.retrievedAt,
    currentRetrievedAt: c.current.retrievedAt,
    currentIsFixture: c.current.isFixture,
    sourceUrl: c.current.sourceUrl,
    reviewedByName: c.reviewedBy?.name ?? null,
    reviewedAt: c.reviewedAt,
    reviewNote: c.reviewNote,
  }))
}

/**
 * Records a review decision on a detected change.
 *
 * VERIFIED needs a note of at least ten characters saying what was compared,
 * as for a partner or property. VERIFIED means a person read both versions
 * and agrees the guest may be told the advice changed. It does not mean ARC
 * vouches for the advice.
 */
export async function reviewSourceChange(
  actor: ActorContext,
  input: ReviewSourceChangeInput,
): Promise<void> {
  assertPlatformAdmin(actor)
  const { changeId, decision, note } = reviewSourceChangeSchema.parse(input)

  if (decision === VerificationStatus.VERIFIED && note.length < 10) {
    throw invalid('Record what you compared before marking a source change verified.')
  }

  await prisma.$transaction(async (tx) => {
    const change = await tx.cultureSourceChange.findUnique({
      where: { id: changeId },
      select: { id: true, verification: true, sourceKey: true },
    })
    if (!change) throw notFound('Source change')

    const decided = decision !== VerificationStatus.PENDING
    // Guard on the state we read, so two admins deciding at once cannot leave an
    // audit trail whose `from` never happened.
    const updated = await tx.cultureSourceChange.updateMany({
      where: { id: change.id, verification: change.verification },
      data: {
        verification: decision,
        reviewedById: decided ? actor.userId : null,
        reviewedAt: decided ? new Date() : null,
        reviewNote: note || null,
      },
    })
    if (updated.count === 0) {
      throw conflict('Someone else decided this change while you were looking at it. Reload and review again.')
    }

    await recordAudit(
      {
        organizationId: null,
        actor,
        actorKind: 'admin',
        action: 'admin.culture.change.review',
        entityType: 'CultureSourceChange',
        entityId: change.id,
        metadata: { sourceKey: change.sourceKey, from: change.verification, to: decision, note },
      },
      tx,
    )
  })
}

export interface SourceHealth {
  sourceKey: string
  destination: string
  authority: string
  sourceUrl: string
  checks: number
  lastCheckedAt: Date | null
  lastCheckOk: boolean | null
  lastFailureReason: string | null
  /** When the content now shown was retrieved. Null if no check ever succeeded. */
  lastSuccessRetrievedAt: Date | null
  lastSuccessIsFixture: boolean | null
  /** Failed checks since the last success: the number that says "this is broken". */
  failuresSinceSuccess: number
  pendingChanges: number
}

/** Source freshness and failure counts for the admin health view. */
export async function getSourceHealth(actor: ActorContext): Promise<SourceHealth[]> {
  assertPlatformAdmin(actor)

  return Promise.all(
    Object.entries(DESTINATION_COUNTRIES).map(async ([destination, country]) => {
      const sourceKey = govukSourceKey(country.govukSlug)
      const [checks, last, lastOk, pendingChanges] = await Promise.all([
        prisma.cultureSourceSnapshot.count({ where: { sourceKey } }),
        prisma.cultureSourceSnapshot.findFirst({
          where: { sourceKey },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, ok: true, failureReason: true },
        }),
        prisma.cultureSourceSnapshot.findFirst({
          where: { sourceKey, ok: true },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, retrievedAt: true, isFixture: true },
        }),
        prisma.cultureSourceChange.count({
          where: { sourceKey, verification: VerificationStatus.PENDING },
        }),
      ])
      const failuresSinceSuccess = await prisma.cultureSourceSnapshot.count({
        where: {
          sourceKey,
          ok: false,
          ...(lastOk ? { createdAt: { gt: lastOk.createdAt } } : {}),
        },
      })
      return {
        sourceKey,
        destination,
        authority: GOVUK_AUTHORITY,
        sourceUrl: govukPublicUrl(country.govukSlug),
        checks,
        lastCheckedAt: last?.createdAt ?? null,
        lastCheckOk: last?.ok ?? null,
        lastFailureReason: last?.failureReason ?? null,
        lastSuccessRetrievedAt: lastOk?.retrievedAt ?? null,
        lastSuccessIsFixture: lastOk?.isFixture ?? null,
        failuresSinceSuccess,
        pendingChanges,
      }
    }),
  )
}

export interface PublishedChangeNotice {
  changeId: string
  detectedAt: Date
  reviewedAt: Date
  changedSections: string[]
  /** The content hash the reviewed change produced. */
  currentHash: string
}

/**
 * The only change information the guest surface may read: the latest change
 * an admin VERIFIED. A PENDING or REJECTED change never produces copy.
 */
export async function getPublishedChangeNotice(
  sourceKey: string,
): Promise<PublishedChangeNotice | null> {
  const change = await prisma.cultureSourceChange.findFirst({
    where: { sourceKey, verification: VerificationStatus.VERIFIED, reviewedAt: { not: null } },
    orderBy: { reviewedAt: 'desc' },
    select: { id: true, detectedAt: true, reviewedAt: true, changedSections: true, currentHash: true },
  })
  if (!change?.reviewedAt) return null
  return {
    changeId: change.id,
    detectedAt: change.detectedAt,
    reviewedAt: change.reviewedAt,
    changedSections: change.changedSections,
    currentHash: change.currentHash,
  }
}
