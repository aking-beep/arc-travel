import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { FixtureTravelAdviceProvider } from '@/modules/integrations/defaults'
import { providerFailed, providerOk, type TravelAdviceProvider } from '@/modules/integrations/types'
import { resolvePortalContext, type PortalContext } from '@/modules/guest/portal'
import { getGuestCultureBrief } from '@/modules/culture-context/service'
import { checkTravelAdviceSource, reviewSourceChange } from '@/modules/culture-context/snapshots'
import { actorFor, createTenant, resetDatabase, type TenantFixture } from '../helpers/factory'

/**
 * The guest brief, end to end from a portal token.
 *
 * The profile is derived from the stay, not a form; the change notice appears
 * only after an admin verifies a change; and a source outage shows as an
 * outage, not as an empty brief.
 */
let tenant: TenantFixture
let context: PortalContext

beforeEach(async () => {
  await resetDatabase()
  tenant = await createTenant({})
  const stay = await prisma.stay.findUniqueOrThrow({
    where: { id: tenant.stayId },
    select: { portalToken: true },
  })
  context = await resolvePortalContext(stay.portalToken)
})

describe('getGuestCultureBrief', () => {
  it('builds a Mexico brief from the stay, with the fixture provider by default', async () => {
    const { brief, country } = await getGuestCultureBrief(context)
    expect(country?.countryCode).toBe('MX')
    expect(brief.items.map((i) => i.category)).toEqual(['entry', 'laws-customs', 'safety'])
    expect(brief.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['COVERAGE_PARTIAL', 'ADVISORY_NOT_LAW', 'FIXTURE_DATA']),
    )
  })

  it('never uses where a guest is from as their passport nationality', async () => {
    await prisma.guest.update({ where: { id: tenant.guestId }, data: { countryCode: 'GB' } })
    const { brief } = await getGuestCultureBrief(context)
    expect(brief.warnings.map((w) => w.code)).toContain('NATIONALITY_UNKNOWN')
  })

  it('ranks by the intake interests the guest already gave (SURF → surfing)', async () => {
    const { brief } = await getGuestCultureBrief(context)
    const safety = brief.items.find((i) => i.category === 'safety')!
    expect(safety.relevance).toContain('topic:surfing')
  })

  it('keeps the laws section for a guest with no interests at all', async () => {
    await prisma.guest.update({ where: { id: tenant.guestId }, data: { interests: [] } })
    const { brief } = await getGuestCultureBrief(context)
    expect(brief.items.some((i) => i.category === 'laws-customs')).toBe(true)
  })

  it('shows an outage as an outage: no items, SOURCE_UNAVAILABLE', async () => {
    const down: TravelAdviceProvider = {
      name: 'govuk',
      isLive: true,
      getAdvice: async () => providerFailed('govuk', 'timeout'),
    }
    const { brief } = await getGuestCultureBrief(context, { travelAdvice: down })
    expect(brief.items).toEqual([])
    expect(brief.warnings.map((w) => w.code)).toContain('SOURCE_UNAVAILABLE')
  })

  it('says a destination is not covered rather than guessing a country', async () => {
    await prisma.place.update({ where: { id: tenant.placeId }, data: { destination: 'atlantis' } })
    const { brief, country } = await getGuestCultureBrief(context)
    expect(country).toBeNull()
    expect(brief.items).toEqual([])
    expect(brief.warnings.map((w) => w.code)).toContain('DESTINATION_UNSUPPORTED')
  })

  it('shows a change notice only after an admin verifies the change', async () => {
    const fixture = (await new FixtureTravelAdviceProvider().getAdvice({ slug: 'mexico' })).data!
    const payload = structuredClone(fixture.payload) as {
      details: { parts: Array<{ slug: string; body: string }> }
    }
    payload.details.parts[0]!.body += '<p>Changed.</p>'
    const edited: TravelAdviceProvider = {
      name: 'fixture',
      isLive: false,
      getAdvice: async () => providerOk('fixture', { ...fixture, payload }),
    }

    await checkTravelAdviceSource({
      destination: 'puerto-escondido',
      provider: new FixtureTravelAdviceProvider(),
      now: new Date('2026-10-21T10:00:00Z'),
    })
    const detected = await checkTravelAdviceSource({
      destination: 'puerto-escondido',
      provider: edited,
      now: new Date('2026-10-21T11:00:00Z'),
    })

    expect((await getGuestCultureBrief(context)).changeNotice).toBeNull()

    const admin = await prisma.user.create({
      data: { email: `admin-${Date.now()}@example.com`, name: 'Admin', isPlatformAdmin: true },
    })
    await reviewSourceChange(await actorFor(admin.id), {
      changeId: detected.changeId!,
      decision: 'VERIFIED',
      note: 'Compared both; the entry section gained a sentence.',
    })

    expect((await getGuestCultureBrief(context)).changeNotice?.changeId).toBe(detected.changeId)
  })
})
