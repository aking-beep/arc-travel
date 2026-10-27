/**
 * Mariana — runs Escuela Olas Verdes, two instructors and a van.
 *
 * She wants to keep her own listing honest, set her own price, and see what she
 * is owed. She does not want to be able to mark herself verified, and the
 * product's credibility depends on her not being able to.
 */
import { held, type Agent, type PersonaModule } from '../agent.js'

const PARTNER_EMAIL = 'mariana@olasverdes.demo'

const persona: PersonaModule = {
  id: 'supplier-partner',
  name: 'Mariana — local partner',
  goal: 'Keep her business page current, draft a listing, set a price, and read her earnings.',

  async run(agent: Agent) {
    const { page } = agent

    await agent.step('sign in', async () => {
      await agent.signInAsDemo(PARTNER_EMAIL, '/partner')
      await agent.check('partner-surface-loads', 'blocker', 'Signing in lands on her own partner surface.', async () => {
        const t = await agent.text()
        return t.length > 100 && page.url().includes('/partner') ? true : `${page.url()} — ${t.slice(0, 200)}`
      })
    })

    await agent.step('edit her business page', async () => {
      await page.goto(`${agent.baseUrl}/partner/profile`)
      const value = `Two instructors, small groups, Zicatela and La Punta. ${Date.now()}`
      const field = page.getByLabel('What you do')
      await field.fill(value)
      await page.getByRole('button', { name: /^Save$/ }).click()
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.reload()
      await agent.check('partner-profile-persists', 'major', 'What she writes about her business is stored, not echoed.', async () => {
        const after = await page.getByLabel('What you do').inputValue().catch(() => '')
        return after === value ? true : `read back "${after.slice(0, 120)}"`
      })
    })

    await agent.step('she cannot verify herself', async () => {
      const t = await agent.text()
      await agent.check('partner-cannot-self-verify', 'blocker', 'Nothing on her surface writes verification or an insurance check (ADR-041).', async () => {
        const insurance = await page.getByLabel(/insurance on file/i).count()
        const verify = await page.getByRole('button', { name: /^verify/i }).count()
        return insurance === 0 && verify === 0 ? true : `insurance controls: ${insurance}, verify buttons: ${verify}`
      })
      await agent.check('partner-told-who-verifies', 'major', 'The page says only ARC can verify a business.', async () =>
        t.includes('only arc can mark a business as verified') || t.includes('arc will check') ? true : t.slice(0, 400),
      )
    })

    await agent.step('draft a listing and hand it over', async () => {
      await page.goto(`${agent.baseUrl}/partner/listings/new`)
      const title = `Dawn patrol pressure test ${Date.now()}`
      await page.getByLabel('Which hotel').selectOption({ index: 1 })
      await page.getByLabel('Kind of activity').selectOption({ index: 1 })
      await page.getByLabel('Title (English)').fill(title)
      await page.getByLabel('How long (minutes)').fill('150')
      await page.getByLabel('Smallest party').fill('1')
      await page.getByLabel('Largest party').fill('4')
      await page.getByLabel('Places per departure').fill('4')
      await page.getByLabel('Where you meet').fill('The palapa at the end of the beach road')
      await page.getByLabel('Price per person (pesos)').fill('850')
      await page.getByRole('button', { name: /save as a draft/i }).click()

      const ok = await page
        .getByRole('heading', { name: title, level: 1 })
        .waitFor({ state: 'visible', timeout: 25_000 }).then(() => true).catch(() => false)
      await agent.check('partner-drafts-listing', 'blocker', 'She can draft her own listing.', async () => (ok ? true : `on ${page.url()}`))
      if (!ok) return

      await agent.check('draft-is-not-bookable', 'major', 'A draft is visible only to her and the hotel.', () =>
        agent.visible(/only you and the hotel can see it/i),
      )

      await page.getByRole('button', { name: /send to the hotel/i }).click()
      // Durable state, not the form message: `revalidatePath` resets the one
      // and moves the other.
      const handedOver = await agent.visible(/with the hotel/i, 15_000)
      await agent.check('partner-cannot-publish', 'blocker', 'She hands the listing to the hotel; she cannot publish it herself (ADR-041).', async () => {
        const publish = await page.getByRole('button', { name: /publish/i }).count()
        if (publish > 0) return `${publish} publish controls on the partner surface`
        return handedOver ? true : `no publish control, but the listing does not read as handed over either: ${(await agent.text()).slice(0, 250)}`
      })
    })

    await agent.step('price on a published listing', async () => {
      await page.goto(`${agent.baseUrl}/partner/listings`)
      const links = page.locator('li a[href^="/partner/listings/"]')
      const count = await links.count()
      let locked = false
      for (let i = 0; i < count; i += 1) {
        await page.goto(`${agent.baseUrl}/partner/listings`)
        await page.locator('li a[href^="/partner/listings/"]').nth(i).click()
        if (await agent.visible(/details are locked/i, 6_000)) {
          locked = true
          break
        }
      }
      if (!locked) {
        agent.skip('published-price-open', 'major', 'A published listing keeps its price editable while locking its details.', `None of this partner's ${count} listings is published, so there is no locked one to check.`)
        return
      }
      await agent.check('published-price-open', 'major', 'A published listing keeps its price editable while locking its details (ADR-041).', async () => {
        const priceButton = await page.getByRole('button', { name: /set the new price/i }).isEnabled().catch(() => false)
        const detailSave = await page.getByRole('button', { name: /^Save$/ }).count()
        return priceButton && detailSave === 0 ? true : `price editable: ${priceButton}, detail save buttons: ${detailSave}`
      })
    })

    await agent.step('availability, bookings and earnings', async () => {
      for (const route of ['/partner/availability', '/partner/bookings', '/partner/earnings']) {
        await page.goto(`${agent.baseUrl}${route}`)
        const t = await agent.text()
        await agent.check(`loads${route.replace(/\//g, '-')}`, 'major', `${route} renders for a partner.`, async () =>
          t.length > 80 && !t.includes('application error') ? true : t.slice(0, 300),
        )
      }
      const t = await agent.text()
      await agent.check('earnings-is-earned-only', 'major', 'Her earnings page does not mix what she earned with what she might.', async () => {
        const bad = /(total|combined)[^.\n]{0,40}(potential|pipeline)/.exec(t)
        return bad === null ? true : `found "${bad[0]}"`
      })
    })

    await agent.step('tenant isolation', async () => {
      // She must not be able to read the hotel's surfaces, nor another
      // supplier's. The routes she should not have are tried as her.
      /*
       * Judged on whether the *content* of the surface came back, not on
       * whether the word "sign in" appears: it appears in the header nav of
       * every page, so the first version of this probe passed on any 200.
       */
      const forbidden: Array<[string, RegExp]> = [
        ['/owner', /next arrivals|arrivals today|owner dashboard/i],
        ['/owner/revenue', /commission|earned this|revenue for/i],
        ['/admin', /only route to a verified status|verification queue/i],
      ]
      for (const [route, marker] of forbidden) {
        const probe = await agent.asMe(route)
        await agent.check(
          `partner-refused${route.replace(/\//g, '-')}`,
          'blocker',
          `A partner session cannot read ${route}.`,
          async () => {
            if (probe.status >= 400) return held(`HTTP ${probe.status}`)
            if (marker.test(probe.body)) return `HTTP ${probe.status} and the surface rendered: matched ${String(marker)}`
            return held(`HTTP ${probe.status}, but none of the surface's own content came back`)
          },
        )
      }
    })
  },
}

export default persona
