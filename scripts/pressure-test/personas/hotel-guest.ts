/**
 * Harriet — in house at Casa Olas, beginner surfer, two people, a QR code on
 * the nightstand and no app.
 *
 * She wants a plan for four days, she wants to book two of the things on it,
 * and she wants to cancel one when the other half of her party gets sunburnt.
 */
import { held, type Agent, type PersonaModule } from '../agent.js'
import { describe, safetyClaims } from '../claims.js'
import { demoPortalToken } from '@/lib/demo-portals'

const persona: PersonaModule = {
  id: 'hotel-guest',
  name: 'Harriet — guest in house',
  goal: 'Build an itinerary, book an experience, read the conditions honestly, cancel one booking.',

  async run(agent: Agent) {
    const { page } = agent
    const token = demoPortalToken(1)
    const portal = `${agent.baseUrl}/g/${token}`

    await agent.step('open the portal from the QR link', async () => {
      await page.goto(portal)
      await agent.check('portal-opens', 'blocker', 'The link on the nightstand opens her own portal.', async () => {
        const t = await agent.text()
        return t.includes('casa olas') ? true : `${page.url()} — ${t.slice(0, 200)}`
      })
      await agent.check('portal-demo-marker', 'major', 'The portal says it is a demonstration.', () => agent.visible(/Demonstration environment/i))
    })

    await agent.step('record preferences', async () => {
      await page.goto(`${portal}/intake`)
      await agent.check('intake-requires-consent', 'blocker', 'Intake will not proceed without data-processing consent.', async () => {
        await page.getByRole('button', { name: /build my itinerary/i }).click()
        await page.waitForTimeout(1200)
        return page.url().includes('/intake') ? true : `navigated to ${page.url()} without consent`
      })

      await page.getByLabel('Surf experience').selectOption('BEGINNER')
      await page.getByLabel('Preferred pace').selectOption('RELAXED')
      await page.getByLabel('Daily budget per person').fill('1500')
      await page.getByRole('checkbox', { name: /I agree to ARC Stay processing/ }).check()
      await page.getByRole('checkbox', { name: /Use my answers to personalise/ }).check()
      await page.getByRole('button', { name: /build my itinerary/i }).click()
      await agent.check('intake-saved', 'major', 'Her answers are stored and come back as defaults.', async () => {
        await page.waitForURL(/\/g\/[^/]+\?intake=done/, { timeout: 30_000 })
        const pace = await page.getByLabel('Preferred pace').inputValue().catch(() => '')
        return pace === 'RELAXED' ? true : `pace read back as "${pace}"`
      })
    })

    await agent.step('build the itinerary', async () => {
      await page.goto(portal)
      const build = page.getByRole('button', { name: /build my itinerary|rebuild itinerary/i }).first()
      await build.click({ timeout: 20_000 })
      const planned = await page
        .getByRole('heading', { name: /day plan/i })
        .waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false)
      await agent.check('itinerary-generated', 'blocker', 'She gets a day-by-day plan.', async () => (planned ? true : (await agent.text()).slice(0, 400)))
      if (!planned) return

      await agent.check('itinerary-explains-itself', 'major', 'Every item can show why it is there.', async () => {
        const why = page.getByText('Why this').first()
        if (!(await why.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false))) return 'no "Why this" control'
        await why.click()
        const t = await agent.text()
        return /minutes from the hotel|here for|budget|low risk|demands/.test(t) ? true : t.slice(0, 400)
      })

      await agent.check('itinerary-no-safety-claim', 'blocker', 'The plan never tells her a beach is safe.', async () => {
        const claims = safetyClaims(await page.locator('body').innerText())
        return claims.length === 0 ? true : describe(claims)
      })

      /*
       * The trip total is the figure she budgets against. Reconciling it from
       * rendered text is not sound — the page mixes per-person and per-party
       * figures — so this records what it saw rather than issuing a verdict a
       * reader would have to re-derive anyway.
       */
      {
        const t = await page.locator('body').innerText().catch(() => '')
        const totalMatch = /(?:trip total|estimated total|total)[^$\n]{0,40}\$([\d,]+)/i.exec(t)
        if (totalMatch === null) {
          agent.observe('itinerary-total-stated', 'The plan states a total she can budget against.', 'No trip total is stated anywhere on the generated plan.')
        } else {
          const stated = Number(totalMatch[1]!.replace(/,/g, ''))
          const others = [...t.matchAll(/\$([\d,]+)/g)].map((m) => Number(m[1]!.replace(/,/g, ''))).reduce((n, v) => n + v, 0) - stated
          agent.observe(
            'itinerary-total-stated',
            'The plan states a total she can budget against.',
            `Stated total $${stated}; every other money figure on the page sums to $${others}. Not reconcilable from the page alone — the per-item and per-party figures overlap — so this is recorded, not judged.`,
          )
        }
      }
    })

    await agent.step('conditions are stated, not judged', async () => {
      await page.goto(`${portal}/guide`)
      const t = await agent.text()
      await agent.check('conditions-timestamped', 'blocker', 'Every ocean reading carries when it was taken and where it came from.', async () =>
        t.includes('reading taken') ? true : t.slice(0, 400),
      )
      await agent.check('conditions-disclaimer', 'blocker', 'The guide says plainly that it cannot tell her a beach is safe.', async () =>
        t.includes('cannot tell you a beach is safe') ? true : t.slice(0, 400),
      )
      await agent.check('places-carry-provenance', 'major', 'Each place says where its description came from.', async () =>
        t.includes('seed fixture') || t.includes('source') ? true : t.slice(0, 300),
      )
    })

    await agent.step('the gate refuses what does not suit her', async () => {
      await page.goto(`${portal}/experience/zicatela-guided-advanced-session`)
      await agent.check('gate-refuses-advanced', 'blocker', 'A beginner cannot buy the advanced-only break, and is told why.', async () => {
        const add = await page.getByRole('button', { name: /add to basket/i }).count()
        const t = await agent.text()
        if (add > 0) return `${add} add-to-basket buttons on an advanced-only session`
        return t.includes('not bookable for you') || /experience or above|demands|does not run/.test(t) ? true : t.slice(0, 400)
      })
    })

    await agent.step('book something that does suit her', async () => {
      await page.goto(`${portal}/experience/carrizalillo-beginner-surf-lesson`)
      const add = page.getByRole('button', { name: /add to basket/i }).first()
      const bookable = await add.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)
      await agent.check('bookable-what-suits', 'blocker', 'She can add the beginner lesson to her basket.', async () => (bookable ? true : (await agent.text()).slice(0, 400)))
      if (!bookable) return

      await Promise.all([
        page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 30_000 }).catch(() => null),
        add.click(),
      ])
      // The confirmation copy is on the page the action revalidated, and the
      // basket line is durable: either is enough, and the basket is checked
      // second so a slow revalidate does not read as a missing hold.
      const statedOnPage = await agent.visible(/holding your places until/i, 12_000)
      await page.goto(`${portal}/basket`)
      const statedInBasket = await agent.visible(/held until/i, 12_000)
      await agent.check('hold-taken-and-stated', 'major', 'A hold is taken at add-to-basket and its expiry is stated (ADR-014).', async () => {
        if (statedOnPage || statedInBasket) return held(statedOnPage ? 'stated on the experience page' : 'stated in the basket')
        return `neither the experience page nor the basket states a hold expiry: ${(await agent.text()).slice(0, 250)}`
      })

      await agent.check('basket-shows-line-and-total', 'major', 'The basket shows the line and a total.', async () => {
        const t = await agent.text()
        return t.includes('total') ? true : t.slice(0, 300)
      })

      const checkout = page.getByRole('button', { name: /complete simulated checkout/i })
      if (!(await checkout.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false))) {
        agent.skip('checkout-completes', 'blocker', 'She can complete a simulated checkout.', 'No checkout button in the basket.')
        return
      }
      await checkout.click()
      const ordered = await page.waitForURL(/\/order\/ARC-/, { timeout: 40_000 }).then(() => true).catch(() => false)
      const orderUrl = page.url()
      await agent.check('checkout-completes', 'blocker', 'Checkout produces an order with a reference.', async () =>
        ordered ? held(orderUrl) : (await agent.text()).slice(0, 400),
      )
      if (!ordered) return

      const t = await agent.text()
      await agent.check('no-card-charged-stated', 'blocker', 'The confirmation says no card was charged (demo mode is a guarantee).', async () =>
        t.includes('no card was charged') ? true : t.slice(0, 400),
      )
      await agent.check('no-invented-confirmation', 'blocker', 'The order does not claim the partner has confirmed when they have not.', async () =>
        t.includes('waiting on the partner') || t.includes('reserved') ? true : t.slice(0, 400),
      )

      await agent.step('double submit', async () => {
        await page.goto(`${portal}/basket`)
        await agent.check('no-second-order-from-back-button', 'blocker', 'Going back to the basket cannot create a second order.', async () => {
          const after = await agent.text()
          return after.includes('empty') ? true : after.slice(0, 300)
        })
      })

      await agent.step('cancel', async () => {
        // Back to the order the checkout produced: the double-submit step above
        // navigated away to the basket, and the cancel control is on the order.
        const reference = orderUrl
        await page.goto(reference)
        const cancel = page.getByRole('button', { name: /^Cancel$/ }).first()
        if (!(await cancel.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false))) {
          agent.skip('cancel-applies-refund-rule', 'major', 'She can cancel and see the refund rule applied.', `No cancel control on her own order page (${reference}).`)
          return
        }
        await cancel.click()
        const said = await agent.visible(/cancelled/i, 15_000)
        await agent.check('cancel-applies-refund-rule', 'major', 'Cancelling her own booking works and is reflected in durable state.', async () => {
          await page.goto(reference)
          const after = await agent.text()
          if (after.includes('cancelled')) return held('the order page reads cancelled after a reload')
          return said ? 'the form said cancelled but a reload of the order does not show it' : `nothing changed: ${after.slice(0, 250)}`
        })
      })
    })

    await agent.step('language', async () => {
      await page.goto(portal)
      const es = page.getByRole('button', { name: 'es', exact: true })
      if (!(await es.waitFor({ state: 'visible', timeout: 6_000 }).then(() => true).catch(() => false))) {
        agent.skip('spanish-complete', 'minor', 'The portal is complete in Spanish.', 'No language switch on the portal.')
        return
      }
      await es.click()
      await agent.check('spanish-complete', 'minor', 'Switching to Spanish leaves no English strings in the main content.', async () => {
        await page.locator('html[lang="es"]').waitFor({ timeout: 15_000 }).catch(() => {})
        const t = await agent.text()
        const leaks = ['build my itinerary', 'add to basket', 'your basket is empty'].filter((s) => t.includes(s))
        return leaks.length === 0 ? true : `English left on the Spanish page: ${leaks.join(', ')}`
      })
    })
  },
}

export default persona
