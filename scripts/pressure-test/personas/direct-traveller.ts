/**
 * Sam — not staying at Casa Olas, not staying anywhere yet. Found ARC from a
 * search, wants to book two days of things to do in Puerto Escondido.
 *
 * This is the journey with no front desk in it, so it is the one where the
 * product has to stand on its own: a public page that can transact, an account
 * created from nothing, and a trip that must never read as a room booking.
 */
import { held, type Agent, type PersonaModule } from '../agent.js'
import { describe, safetyClaims, verificationClaims } from '../claims.js'

const PASSPHRASE = 'an entirely ordinary passphrase'
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

const persona: PersonaModule = {
  id: 'direct-traveller',
  name: 'Sam — first-time visitor, no hotel',
  goal: 'Arrive cold on the public site, work out what this is, create an account, plan and book two days.',

  async run(agent: Agent) {
    const { page } = agent
    const email = `sam.pressure.${Date.now()}@example.invalid`

    await agent.step('the public front door', async () => {
      await page.goto(agent.baseUrl)
      const t = await agent.text()
      await agent.check('home-loads', 'blocker', 'The home page loads and says what this is.', async () =>
        t.length > 300 ? true : t.slice(0, 300),
      )
      await agent.check('home-offers-a-way-in', 'major', 'From the home page there is a route to booking something.', async () => {
        const links = await page.getByRole('link', { name: /plan|experiences|stays|sign up|book/i }).count()
        return links > 0 ? held(`${links} routes offered`) : 'nothing on the home page leads to a booking'
      })
      await agent.check('home-no-safety-claim', 'blocker', 'The marketing surface makes no safety claim.', async () => {
        const claims = safetyClaims(await page.locator('body').innerText())
        return claims.length === 0 ? true : describe(claims)
      })
      await agent.check('home-no-invented-verification', 'blocker', 'No partner is described as verified or approved on a public page.', async () => {
        const claims = verificationClaims(await page.locator('body').innerText())
        return claims.length === 0 ? true : describe(claims)
      })
    })

    await agent.step('browse before committing', async () => {
      for (const route of ['/experiences', '/stays', '/destinations', '/plan', '/trips', '/search']) {
        await page.goto(`${agent.baseUrl}${route}`)
        const t = await agent.text()
        await agent.check(`public-loads${route.replace(/\//g, '-')}`, 'major', `${route} renders for an anonymous visitor.`, async () =>
          t.length > 120 && !t.includes('application error') ? true : t.slice(0, 300),
        )
      }
      await page.goto(`${agent.baseUrl}/experiences`)
      const t = await agent.text()
      await agent.check('experiences-no-invented-verification', 'blocker', 'The public catalogue describes no partner as verified.', async () => {
        const claims = verificationClaims(await page.locator('body').innerText())
        return claims.length === 0 ? true : describe(claims)
      })
      await agent.check('experiences-separates-illustrative-from-live', 'major', 'The two catalogues are distinguishable (ADR-027).', async () =>
        t.includes('illustrative') || t.includes('unverified') ? true : t.slice(0, 400),
      )
    })

    await agent.step('the public planner under bad input', async () => {
      /*
       * Driven through the form, not through the query string: `/plan` reads
       * only `?sample=`, so a probe that put dates in the URL was testing
       * nothing and reported the planner as silent when it had never been
       * asked. The form is the input surface.
       */
      await page.goto(`${agent.baseUrl}/plan`)
      const arrive = page.locator('input[type="date"]').first()
      const leave = page.locator('input[type="date"]').nth(1)
      if (!(await arrive.waitFor({ state: 'visible', timeout: 12_000 }).then(() => true).catch(() => false))) {
        agent.skip('planner-refuses-reversed-range', 'major', 'A reversed date range is refused rather than clamped silently.', 'No date inputs on /plan.')
        return
      }

      await arrive.fill(day(8))
      // `min` on the second input is the first date, so this is typed past the
      // browser's own constraint the way a pasted value would be.
      await leave.evaluate((node, value) => {
        const el = node as HTMLInputElement
        el.removeAttribute('min')
        el.value = value
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }, day(3))

      await agent.check('planner-refuses-reversed-range', 'major', 'A reversed date range is refused rather than clamped silently.', async () => {
        const complained = await agent.visible(/must be after the arrival|before the planner can draft/i, 10_000)
        const generate = page.getByRole('button', { name: /draft|generate|plan/i }).last()
        const blocked = await generate.isDisabled().catch(() => false)
        if (complained && blocked) return held('the planner names the problem and the draft button is disabled')
        if (complained) return held('the planner names the problem')
        return blocked ? held('the draft button is disabled, though nothing says why') : 'a departure before the arrival produces neither a complaint nor a disabled button'
      })

      await agent.check('planner-refuses-zero-travellers', 'major', 'A party of zero is refused.', async () => {
        await page.goto(`${agent.baseUrl}/plan`)
        const fewer = page.getByRole('button', { name: /fewer travellers/i })
        if (!(await fewer.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false))) {
          return 'no traveller control to push below one'
        }
        for (let i = 0; i < 8; i += 1) await fewer.click().catch(() => {})
        const t = await agent.text()
        const zero = /\b0 travellers?\b|\bfor 0\b/.test(t)
        const complained = /between 1 and 12 travellers/i.test(t)
        if (zero && !complained) return 'the planner accepted a party of zero without complaint'
        return held(complained ? 'refused with "between 1 and 12 travellers"' : 'the control will not go below one')
      })
    })

    await agent.step('create an account with no booking reference', async () => {
      await page.goto(`${agent.baseUrl}/sign-up/direct`)
      await agent.check('direct-signup-exists', 'blocker', 'There is a sign-up for somebody with no room.', async () => {
        const heading = await page.getByRole('heading', { name: 'Plan a trip', level: 1 }).waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false)
        return heading ? true : (await agent.text()).slice(0, 300)
      })
      await agent.check('direct-signup-books-no-room', 'blocker', 'The form says plainly that it books no accommodation (ADR-042).', () =>
        agent.visible(/books no accommodation/i),
      )
      await agent.check('direct-signup-asks-no-reference', 'major', 'It asks for no booking reference, because he has none.', async () => {
        const count = await page.getByLabel(/booking reference/i).count()
        return count === 0 ? true : `${count} reference fields`
      })

      await page.getByLabel('Where you want to book through').selectOption({ index: 1 })
      await page.getByLabel('First day').fill(day(2))
      await page.getByLabel('Last day').fill(day(4))
      await page.getByLabel('How many of you').fill('2').catch(() => {})
      await page.getByLabel('Your name').fill('Sam Okafor')
      await page.getByLabel('Email').fill(email)
      await page.getByLabel('Password', { exact: true }).fill(PASSPHRASE)
      await page.getByLabel('Confirm password').fill(PASSPHRASE)
      await page.getByRole('checkbox').first().check()
      await page.getByRole('button', { name: /create the account and start planning/i }).click()

      const landed = await page.waitForURL(/\/g\/[A-Za-z0-9_-]+$/, { timeout: 40_000 }).then(() => true).catch(() => false)
      await agent.check('direct-signup-lands-in-planner', 'blocker', 'Creating the account puts him straight into the planner.', async () =>
        landed ? held(page.url()) : `${page.url()} — ${(await agent.text()).slice(0, 400)}`,
      )
      if (landed) agent.note(`Direct trip portal: ${page.url()}`)
    })

    await agent.step('his account calls it a trip', async () => {
      await page.goto(`${agent.baseUrl}/me`)
      // `/me` streams its bookings behind a Suspense boundary, so the first
      // read catches "Loading your bookings…" rather than the answer.
      await agent.settled()
      const t = await agent.text()
      await agent.check('me-loads', 'major', 'His account page lists what he has booked.', async () => (t.length > 150 ? true : t.slice(0, 300)))
      await agent.check('trip-not-a-stay', 'blocker', 'A direct trip is labelled as a trip with no room (ADR-042).', async () =>
        t.includes('no room') ? true : t.slice(0, 400),
      )
      await agent.check('no-room-words-for-direct', 'major', 'Room words such as check-in do not appear for somebody with no room.', async () =>
        /check[- ]in\b/.test(t) ? `found a check-in label on a roomless trip: ${t.slice(0, 300)}` : true,
      )
    })

    await agent.step('plan and book as a direct customer', async () => {
      await page.goto(`${agent.baseUrl}/me`)
      await agent.settled()
      const open = page.getByRole('link', { name: /open|plan|trip/i }).first()
      if (!(await open.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false))) {
        agent.skip('direct-can-book', 'blocker', 'A direct customer can buy an experience.', 'No link from the account into his trip.')
        return
      }
      await open.click()
      await page.waitForLoadState('networkidle').catch(() => {})
      const portal = new URL(page.url()).pathname.replace(/\/$/, '')

      await page.goto(`${agent.baseUrl}${portal}/explore`)
      const t = await agent.text()
      await agent.check('direct-explore-has-stock', 'major', 'He can see something to buy.', async () => (t.includes('$') ? true : t.slice(0, 400)))
      await agent.check('direct-no-invented-verification', 'blocker', 'Nothing he is offered claims a verification ARC has not made.', async () => {
        const claims = verificationClaims(await page.locator('body').innerText())
        return claims.length === 0 ? true : describe(claims)
      })

      // Buy the first thing offered, whatever it is.
      const firstExperience = page.locator('a[href*="/experience/"]').first()
      if (!(await firstExperience.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false))) {
        agent.skip('direct-can-book', 'blocker', 'A direct customer can buy an experience.', 'Nothing bookable on his explore page.')
        return
      }
      await firstExperience.click()
      const add = page.getByRole('button', { name: /add to basket/i }).first()
      if (!(await add.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false))) {
        agent.skip('direct-can-book', 'blocker', 'A direct customer can buy an experience.', `No add-to-basket on ${page.url()} — may be correctly gated.`)
        return
      }
      await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 30_000 }).catch(() => null), add.click()])
      await page.goto(`${agent.baseUrl}${portal}/basket`)
      const checkout = page.getByRole('button', { name: /complete simulated checkout/i })
      if (!(await checkout.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false))) {
        agent.skip('direct-can-book', 'blocker', 'A direct customer can buy an experience.', 'Basket offered no checkout.')
        return
      }
      await checkout.click()
      const ordered = await page.waitForURL(/\/order\/ARC-/, { timeout: 40_000 }).then(() => true).catch(() => false)
      await agent.check('direct-can-book', 'blocker', 'A direct customer can buy an experience end to end.', async () =>
        ordered ? held(page.url()) : (await agent.text()).slice(0, 400),
      )
    })

    await agent.step('password reset tells him nothing he should not know', async () => {
      await page.goto(`${agent.baseUrl}/forgot-password`)
      const emailField = page.getByLabel(/email/i).first()
      if (!(await emailField.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false))) {
        agent.skip('reset-does-not-enumerate', 'major', 'A reset form does not confirm whether an address has an account.', 'No email field on /forgot-password.')
        return
      }
      await emailField.fill('definitely-nobody-here@example.invalid')
      await page.getByRole('button', { name: /send|reset/i }).first().click()
      const unknown = (await agent.text()).slice(0, 600)
      await page.goto(`${agent.baseUrl}/forgot-password`)
      await page.getByLabel(/email/i).first().fill(email)
      await page.getByRole('button', { name: /send|reset/i }).first().click()
      const known = (await agent.text()).slice(0, 600)
      await agent.check('reset-does-not-enumerate', 'major', 'A reset answers identically whether or not the address has an account (ADR-040).', async () =>
        unknown.replace(/\s+/g, ' ') === known.replace(/\s+/g, ' ')
          ? true
          : `different answers — unknown: "${unknown.slice(0, 200)}" / known: "${known.slice(0, 200)}"`,
      )
    })
  },
}

export default persona
