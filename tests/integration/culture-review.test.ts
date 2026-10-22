import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { isAppError } from '@/lib/errors'
import { VerificationStatus } from '@/lib/prisma-types'
import { FixtureTravelAdviceProvider } from '@/modules/integrations/defaults'
import {
  providerFailed,
  providerOk,
  type TravelAdviceDocument,
  type TravelAdviceProvider,
} from '@/modules/integrations/types'
import {
  checkTravelAdviceSource,
  getPublishedChangeNotice,
  getSourceChangeQueue,
  getSourceHealth,
  refreshTravelAdvice,
  reviewSourceChange,
} from '@/modules/culture-context/snapshots'
import { actorFor, createTenant, resetDatabase, type TenantFixture } from '../helpers/factory'

/**
 * Snapshots, change detection and review.
 *
 * The behaviour under test is "a hash change is a review item, not a
 * publication": a new hash opens a PENDING change, a guest-readable notice
 * exists only after an admin VERIFIES it with a note, and every check
 * (failed ones too) is on the record.
 */
const DESTINATION = 'puerto-escondido'
const SOURCE = 'govuk:mexico'

let tenant: TenantFixture
let fixtureDoc: TravelAdviceDocument

const t = (minutes: number) => new Date(Date.UTC(2026, 9, 21, 12, minutes))

/** The fixture with one extra paragraph in the entry section. */
function editedProvider(extra: string): TravelAdviceProvider {
  const payload = structuredClone(fixtureDoc.payload) as {
    details: { parts: Array<{ slug: string; body: string }> }
  }
  payload.details.parts.find((p) => p.slug === 'entry-requirements')!.body += `<p>${extra}</p>`
  return {
    name: 'fixture',
    isLive: false,
    getAdvice: async () => providerOk('fixture', { ...fixtureDoc, payload }),
  }
}

const down: TravelAdviceProvider = {
  name: 'govuk',
  isLive: true,
  getAdvice: async () => providerFailed('govuk', 'http_503'),
}

async function adminActor() {
  const admin = await prisma.user.create({
    data: { email: `admin-${crypto.randomUUID()}@example.com`, name: 'Admin', isPlatformAdmin: true },
  })
  return actorFor(admin.id)
}

beforeEach(async () => {
  await resetDatabase()
  tenant = await createTenant({})
  fixtureDoc = (await new FixtureTravelAdviceProvider().getAdvice({ slug: 'mexico' })).data!
})

describe('checkTravelAdviceSource', () => {
  it('records a baseline, then an unchanged check, with no review item', async () => {
    const provider = new FixtureTravelAdviceProvider()
    const first = await checkTravelAdviceSource({ destination: DESTINATION, provider, now: t(0) })
    const second = await checkTravelAdviceSource({ destination: DESTINATION, provider, now: t(1) })

    expect(first.outcome).toBe('baseline')
    expect(second.outcome).toBe('unchanged')
    expect(second.contentHash).toBe(first.contentHash)
    expect(await prisma.cultureSourceSnapshot.count({ where: { sourceKey: SOURCE } })).toBe(2)
    expect(await prisma.cultureSourceChange.count()).toBe(0)
  })

  it('opens a PENDING change naming the changed section when the hash differs', async () => {
    await checkTravelAdviceSource({
      destination: DESTINATION,
      provider: new FixtureTravelAdviceProvider(),
      now: t(0),
    })
    const result = await checkTravelAdviceSource({
      destination: DESTINATION,
      provider: editedProvider('A new entry rule.'),
      now: t(1),
    })

    expect(result.outcome).toBe('changed')
    const change = await prisma.cultureSourceChange.findUniqueOrThrow({
      where: { id: result.changeId! },
    })
    expect(change.verification).toBe(VerificationStatus.PENDING)
    expect(change.changedSections).toEqual(['entry'])
    expect(change.reviewedById).toBeNull()
  })

  it('records a failed check, and does not compare against it', async () => {
    const provider = new FixtureTravelAdviceProvider()
    await checkTravelAdviceSource({ destination: DESTINATION, provider, now: t(0) })
    const failed = await checkTravelAdviceSource({ destination: DESTINATION, provider: down, now: t(1) })
    const after = await checkTravelAdviceSource({ destination: DESTINATION, provider, now: t(2) })

    expect(failed).toMatchObject({ outcome: 'unavailable', failureReason: 'http_503', contentHash: null })
    expect(after.outcome).toBe('unchanged')
  })

  it('never overwrites history', async () => {
    await checkTravelAdviceSource({
      destination: DESTINATION,
      provider: new FixtureTravelAdviceProvider(),
      now: t(0),
    })
    await checkTravelAdviceSource({ destination: DESTINATION, provider: editedProvider('x'), now: t(1) })
    const hashes = await prisma.cultureSourceSnapshot.findMany({
      where: { sourceKey: SOURCE },
      orderBy: { createdAt: 'asc' },
      select: { contentHash: true },
    })
    expect(new Set(hashes.map((h) => h.contentHash)).size).toBe(2)
  })

  it('refuses a destination no source covers', async () => {
    await expect(checkTravelAdviceSource({ destination: 'atlantis' })).rejects.toSatisfy(isAppError)
  })

  it('rejects a successful snapshot without a hash at the database level', async () => {
    await expect(
      prisma.cultureSourceSnapshot.create({
        data: {
          sourceKey: SOURCE,
          authority: 'x',
          sourceClass: 'GOVERNMENT_ADVISORY',
          jurisdiction: 'MX',
          sourceUrl: 'https://www.gov.uk/foreign-travel-advice/mexico',
          provider: 'fixture',
          isFixture: true,
          ok: true,
          retrievedAt: t(0),
        },
      }),
    ).rejects.toThrow()
  })
})

describe('review: nothing publishes without approval', () => {
  async function detectChange() {
    await checkTravelAdviceSource({
      destination: DESTINATION,
      provider: new FixtureTravelAdviceProvider(),
      now: t(0),
    })
    const result = await checkTravelAdviceSource({
      destination: DESTINATION,
      provider: editedProvider('A new entry rule.'),
      now: t(1),
    })
    return result.changeId!
  }

  it('publishes no notice while the change is pending', async () => {
    await detectChange()
    expect(await getPublishedChangeNotice(SOURCE)).toBeNull()
  })

  it('publishes no notice for a rejected change', async () => {
    const changeId = await detectChange()
    await reviewSourceChange(await adminActor(), { changeId, decision: 'REJECTED', note: '' })
    expect(await getPublishedChangeNotice(SOURCE)).toBeNull()
  })

  it('publishes a notice only once an admin verifies it, naming the reviewer, audited without a tenant', async () => {
    const changeId = await detectChange()
    const admin = await adminActor()
    await reviewSourceChange(admin, {
      changeId,
      decision: 'VERIFIED',
      note: 'Compared both versions; entry section gained a paragraph.',
    })

    const notice = await getPublishedChangeNotice(SOURCE)
    expect(notice?.changeId).toBe(changeId)
    expect(notice?.changedSections).toEqual(['entry'])

    const change = await prisma.cultureSourceChange.findUniqueOrThrow({ where: { id: changeId } })
    expect(change.reviewedById).toBe(admin.userId)
    expect(change.reviewedAt).not.toBeNull()

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'admin.culture.change.review', entityId: changeId },
    })
    expect(audit.organizationId).toBeNull()
    expect(audit.actorUserId).toBe(admin.userId)
  })

  it('keeps the review trail honest when two admins decide at once', async () => {
    const changeId = await detectChange()
    const [first, second] = [await adminActor(), await adminActor()]
    await Promise.allSettled([
      reviewSourceChange(first, { changeId, decision: 'VERIFIED', note: 'Compared both; entry changed.' }),
      reviewSourceChange(second, { changeId, decision: 'REJECTED', note: '' }),
    ])

    // Whatever order they land in, each recorded `from` is what the change
    // actually was: no decision silently overturns another.
    const trail = await prisma.auditEvent.findMany({
      where: { action: 'admin.culture.change.review', entityId: changeId },
      orderBy: { createdAt: 'asc' },
    })
    let state: string = VerificationStatus.PENDING
    for (const event of trail) {
      const meta = event.metadataJson as { from: string; to: string }
      expect(meta.from).toBe(state)
      state = meta.to
    }
    const change = await prisma.cultureSourceChange.findUniqueOrThrow({ where: { id: changeId } })
    expect(change.verification).toBe(state)
  })

  it('refuses to verify without a note saying what was compared', async () => {
    const changeId = await detectChange()
    await expect(
      reviewSourceChange(await adminActor(), { changeId, decision: 'VERIFIED', note: 'ok' }),
    ).rejects.toSatisfy(isAppError)
    expect(await getPublishedChangeNotice(SOURCE)).toBeNull()
  })

  it('refuses a non-admin, including the hotel owner', async () => {
    const changeId = await detectChange()
    const owner = await actorFor(tenant.ownerUserId)
    await expect(
      reviewSourceChange(owner, { changeId, decision: 'VERIFIED', note: 'Looks fine to me, really.' }),
    ).rejects.toSatisfy(isAppError)
    await expect(getSourceChangeQueue(owner)).rejects.toSatisfy(isAppError)
    await expect(refreshTravelAdvice(owner, { destination: DESTINATION })).rejects.toSatisfy(isAppError)
    expect(await getPublishedChangeNotice(SOURCE)).toBeNull()
  })

  it('refuses a decision outside the review vocabulary', async () => {
    const changeId = await detectChange()
    await expect(
      reviewSourceChange(await adminActor(), { changeId, decision: 'PUBLISHED', note: '' }),
    ).rejects.toThrow()
  })

  it('lists pending changes first in the admin queue', async () => {
    const changeId = await detectChange()
    const queue = await getSourceChangeQueue(await adminActor())
    expect(queue[0]).toMatchObject({ id: changeId, verification: 'PENDING', changedSections: ['entry'] })
  })
})

describe('getSourceHealth', () => {
  it('reports freshness, failures since the last success and pending changes', async () => {
    const provider = new FixtureTravelAdviceProvider()
    await checkTravelAdviceSource({ destination: DESTINATION, provider, now: t(0) })
    await checkTravelAdviceSource({ destination: DESTINATION, provider: editedProvider('x'), now: t(1) })
    await checkTravelAdviceSource({ destination: DESTINATION, provider: down, now: t(2) })
    await checkTravelAdviceSource({ destination: DESTINATION, provider: down, now: t(3) })

    const [health] = await getSourceHealth(await adminActor())
    expect(health).toMatchObject({
      sourceKey: SOURCE,
      checks: 4,
      lastCheckOk: false,
      lastFailureReason: 'http_503',
      failuresSinceSuccess: 2,
      pendingChanges: 1,
      lastSuccessIsFixture: true,
    })
    expect(health!.lastSuccessRetrievedAt).toEqual(fixtureDoc.retrievedAt)
  })

  it('writes a check and its audit together: a failed audit leaves no snapshot behind', async () => {
    await expect(
      checkTravelAdviceSource({
        destination: DESTINATION,
        provider: new FixtureTravelAdviceProvider(),
        record: async () => {
          throw new Error('audit insert failed')
        },
      }),
    ).rejects.toThrow('audit insert failed')
    expect(await prisma.cultureSourceSnapshot.count({ where: { sourceKey: SOURCE } })).toBe(0)
  })

  it('records an admin-triggered check in the audit trail without a tenant', async () => {
    const admin = await adminActor()
    const result = await refreshTravelAdvice(admin, {
      destination: DESTINATION,
      provider: new FixtureTravelAdviceProvider(),
    })
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'admin.culture.source.check', entityId: result.snapshotId },
    })
    expect(audit.organizationId).toBeNull()
  })
})
