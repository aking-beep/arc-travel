/**
 * The person nobody wants: a guest holding one valid portal link who would like
 * somebody else's itinerary, a stranger who would like a free booking, and two
 * people who want the same last place on the same boat.
 *
 * Every probe here is against the local instance's own seeded data. None of it
 * writes a verification, a condition report or an outbound message — the three
 * things the harness refuses — and none of it touches a deployment.
 */
import { held, type Agent, type PersonaModule } from '../agent.js'
import { demoPortalToken, seededPortalToken } from '@/lib/demo-portals'

interface SlotState {
  slots: Array<{ id: string; capacity: number; booked: number; held: number }>
  invariantHolds: boolean
}

const persona: PersonaModule = {
  id: 'adversary',
  name: 'An adversary — and a race for the last seat',
  goal: 'Reach another guest’s booking, get something for nothing, oversell a departure, and inject something nasty.',

  async run(agent: Agent) {
    const { page, context } = agent
    const mine = demoPortalToken(1)
    const theirs = demoPortalToken(3)

    await agent.step('guessing a portal token', async () => {
      for (const guess of ['demo-portal-01', 'demo-portal-1', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']) {
        const probe = await agent.anonymous(`/g/${guess}`)
        await agent.check(`portal-token-guess-${guess}`, 'blocker', `The portal token "${guess}" does not open anybody’s portal.`, async () => {
          if (probe.status === 404 || probe.status === 403) return held(`HTTP ${probe.status}`)
          const body = probe.body.toLowerCase()
          return body.includes('not found') ? held('HTTP 200 not-found page') : `HTTP ${probe.status} — ${body.slice(0, 200)}`
        })
      }
      // The derived tokens are not in the repository, but the *shape* is. A
      // token derived with the wrong label must not resolve.
      const wrongLabel = seededPortalToken('demo-99-not-a-stay')
      const probe = await agent.anonymous(`/g/${wrongLabel}`)
      await agent.check('portal-token-derivation-scoped', 'major', 'A token derived for a label that is not a seeded stay resolves to nothing.', async () =>
        probe.status >= 400 || probe.body.toLowerCase().includes('not found') ? held(`HTTP ${probe.status}`) : `HTTP ${probe.status} opened a portal`,
      )
    })

    await agent.step('reaching another guest’s order', async () => {
      /*
       * There has to *be* somebody else's order before this probe means
       * anything, and in a fresh seed there is not one reachable from the
       * portal. So the other guest buys something first, in their own context,
       * and the adversary then tries to reach it from their own valid token.
       */
      const browser = context.browser()!
      const victimContext = await browser.newContext({ baseURL: agent.baseUrl })
      const victim = await victimContext.newPage()
      let reference: string | null = null
      try {
        /*
         * Whatever their own explore page offers them, rather than a named
         * experience: this guest is an advanced surfer and the gate correctly
         * refuses them several things, so naming one made the probe skip
         * itself instead of running.
         */
        await victim.goto(`${agent.baseUrl}/g/${theirs}/explore`)
        const links = victim.locator('a[href*="/experience/"]')
        const n = Math.min(await links.count(), 6)
        for (let i = 0; i < n && reference === null; i += 1) {
          await victim.goto(`${agent.baseUrl}/g/${theirs}/explore`)
          await victim.locator('a[href*="/experience/"]').nth(i).click()
          const add = victim.getByRole('button', { name: /add to basket/i }).first()
          if (!(await add.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false))) continue
          await add.click()
          await victim.goto(`${agent.baseUrl}/g/${theirs}/basket`)
          const checkout = victim.getByRole('button', { name: /complete simulated checkout/i })
          if (!(await checkout.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false))) continue
          await checkout.click()
          await victim.waitForURL(/\/order\/ARC-/, { timeout: 40_000 }).catch(() => {})
          reference = /ARC-[A-Z0-9-]+/.exec(victim.url())?.[0] ?? null
        }
      } finally {
        await victimContext.close()
      }

      if (reference === null) {
        agent.skip('cross-guest-order-read', 'blocker', 'One guest cannot open another guest’s order.', 'Could not create an order for the other guest to steal.')
        return
      }
      agent.note(`The other guest's real order is ${reference}; the adversary holds a different valid portal token.`)

      const probe = await agent.anonymous(`/g/${mine}/order/${reference}`)
      await agent.check('cross-guest-order-read', 'blocker', 'A guest cannot open another guest’s order by putting its reference on their own token.', async () => {
        if (probe.status === 404 || probe.status === 403) return held(`HTTP ${probe.status}`)
        const body = probe.body.toLowerCase()
        if (body.includes('not found') || body.includes('forbidden')) return held('HTTP 200 refusal page')
        return `HTTP ${probe.status} returned a page for somebody else's order`
      })

      await page.goto(`${agent.baseUrl}/g/${mine}/order/${reference}`)
      await agent.check('cross-guest-cancel', 'blocker', 'A guest cannot cancel another guest’s booking.', async () => {
        const cancel = page.getByRole('button', { name: /^Cancel$/ }).first()
        if (!(await cancel.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false))) {
          return held('no cancel control is even offered on somebody else’s order')
        }
        await cancel.click()
        await page.waitForLoadState('networkidle').catch(() => {})
        // Judge it from the victim's side, not from the copy on this page.
        const victimCheck = await browser.newContext({ baseURL: agent.baseUrl })
        try {
          const vp = await victimCheck.newPage()
          await vp.goto(`${agent.baseUrl}/g/${theirs}/order/${reference}`)
          const victimText = (await vp.locator('body').innerText().catch(() => '')).toLowerCase()
          return victimText.includes('cancelled')
            ? `the other guest's booking now reads cancelled — one guest cancelled another's`
            : held('the cancel did not take effect on the other guest’s order')
        } finally {
          await victimCheck.close()
        }
      })
    })

    await agent.step('open redirect', async () => {
      /*
       * A probe that only reads the sign-in HTML proves nothing: the redirect
       * happens when the form is submitted. So this signs in for real with a
       * hostile `next` and looks at where the browser ended up.
       */
      for (const target of ['//evil.example.com', 'https://evil.example.com', '/\\evil.example.com']) {
        await agent.check(`open-redirect-${target}`, 'blocker', `next=${target} cannot send a person off-site.`, async () => {
          const ctx = await context.browser()!.newContext({ baseURL: agent.baseUrl })
          try {
            const p = await ctx.newPage()
            await p.goto(`${agent.baseUrl}/sign-in?next=${encodeURIComponent(target)}`)
            const form = p.locator('form:has(input[value="elena@casaolas.demo"])')
            if (!(await form.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false))) {
              return 'could not reach the demo sign-in form to try the redirect'
            }
            await form.getByRole('button', { name: /sign in/i }).click()
            await p.waitForLoadState('load').catch(() => {})
            await p.waitForTimeout(1500)
            const host = new URL(p.url()).host
            return host === new URL(agent.baseUrl).host
              ? held(`landed on ${p.url()}`)
              : `signed in and landed off-site at ${p.url()}`
          } finally {
            await ctx.close()
          }
        })
      }

      // The locale action redirects too, and takes the same parameter.
      await agent.check('open-redirect-locale-action', 'blocker', 'The locale switch cannot be used as a redirector.', async () => {
        const probe = await agent.anonymous(`/?next=${encodeURIComponent('//evil.example.com')}`)
        return probe.status < 300 || !String(probe.finalUrl).includes('evil.example.com')
          ? held(`HTTP ${probe.status} to ${String(probe.finalUrl).slice(0, 80)}`)
          : `redirects to ${String(probe.finalUrl)}`
      })
    })

    await agent.step('claiming a booking that is not theirs', async () => {
      /*
       * `/me` needs an account, so the adversary makes one — the direct
       * sign-up, which asks for no booking reference — and then tries to claim
       * a stay that is not theirs. ADR-039: the reference *and* the email, and
       * one refusal message either way so the form cannot answer "is this a
       * real booking, and whose".
       */
      const email = `adversary.${Date.now()}@example.invalid`
      await page.goto(`${agent.baseUrl}/sign-up/direct`)
      await page.getByLabel('Where you want to book through').selectOption({ index: 1 }).catch(() => {})
      await page.getByLabel('First day').fill(new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)).catch(() => {})
      await page.getByLabel('Last day').fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)).catch(() => {})
      await page.getByLabel('Your name').fill('A Stranger').catch(() => {})
      await page.getByLabel('Email').fill(email).catch(() => {})
      await page.getByLabel('Password', { exact: true }).fill('an entirely ordinary passphrase').catch(() => {})
      await page.getByLabel('Confirm password').fill('an entirely ordinary passphrase').catch(() => {})
      await page.getByRole('checkbox').first().check().catch(() => {})
      await page.getByRole('button', { name: /create the account and start planning/i }).click().catch(() => {})
      await page.waitForURL(/\/g\/[A-Za-z0-9_-]+$/, { timeout: 40_000 }).catch(() => {})

      await page.goto(`${agent.baseUrl}/me`)
      const referenceField = page.getByLabel(/reference/i).first()
      if (!(await referenceField.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false))) {
        agent.skip('claim-needs-both-and-says-nothing', 'major', 'Claiming a booking needs the reference and the email, and refuses with one message.', `No claim form on /me for this account (${page.url()}).`)
        return
      }

      const answers: string[] = []
      for (const [ref, mail] of [
        // A real seeded guest's address, with a reference that does not exist.
        ['ARC-ZZZZ-ZZZZ', 'harriet.okonjo@example.com'],
        // Neither exists.
        ['ARC-ZZZZ-ZZZZ', 'nobody-at-all@example.invalid'],
      ] as const) {
        await page.goto(`${agent.baseUrl}/me`)
        await page.getByLabel(/reference/i).first().fill(ref)
        await page.getByLabel(/email/i).first().fill(mail)
        await page.getByRole('button', { name: /claim|add/i }).first().click()
        await page.waitForLoadState('networkidle').catch(() => {})
        await page.waitForTimeout(800)
        // The refusal, not the whole page: the page carries the account's own
        // content, which differs between loads for reasons of its own.
        const message = await page
          .locator('[role="alert"], [role="status"], .text-red-700, p:has-text("not")')
          .first()
          .innerText()
          .catch(() => '')
        answers.push(message.replace(/\s+/g, ' ').trim().slice(0, 300))
      }

      await agent.check('claim-needs-both-and-says-nothing', 'major', 'A failed claim says the same thing whether or not the address belongs to a real guest (ADR-039).', async () => {
        if (answers[0] === '' && answers[1] === '') return 'neither attempt produced any visible refusal at all'
        return answers[0] === answers[1]
          ? held(`identical refusal both times: "${answers[0]}"`)
          : `different answers — real address: "${answers[0]}" / unknown address: "${answers[1]}"`
      })

      await agent.check('claim-did-not-succeed', 'blocker', 'A claim with a reference that does not exist attaches nothing to the account.', async () => {
        await page.goto(`${agent.baseUrl}/me`)
        const t = await agent.text()
        return t.includes('casa olas') && t.includes('harriet')
          ? 'another guest’s stay appears on the adversary’s account'
          : held('nothing of anyone else’s is on the account')
      })
    })

    await agent.step('two people, one last place', async () => {
      const slug = 'carrizalillo-cove-snorkel'
      const before = await context.request.get(`${agent.baseUrl}/api/e2e/slot-state?experienceSlug=${slug}`, { failOnStatusCode: false })
      if (!before.ok()) {
        agent.skip('no-oversell-under-race', 'blocker', 'Two simultaneous buyers cannot oversell a departure.', `slot-state returned HTTP ${before.status()}`)
        return
      }
      const state = (await before.json()) as SlotState
      const target = state.slots.find((s) => s.capacity - s.booked - s.held >= 1)
      if (target === undefined) {
        agent.skip('no-oversell-under-race', 'blocker', 'Two simultaneous buyers cannot oversell a departure.', 'No departure with a free place to race for.')
        return
      }
      const free = target.capacity - target.booked - target.held
      agent.note(`Raced for slot ${target.id} with ${free} free place(s) of ${target.capacity}.`)

      const browser = context.browser()!
      const racers = await Promise.all(
        [demoPortalToken(1), demoPortalToken(3), demoPortalToken(5)].map(async (token) => {
          const ctx = await browser.newContext({ baseURL: agent.baseUrl })
          const p = await ctx.newPage()
          await p.goto(`${agent.baseUrl}/g/${token}/experience/${slug}`)
          return { ctx, page: p, token }
        }),
      )

      // All three press add-to-basket on the same departure at the same moment.
      await Promise.all(
        racers.map(async (racer) => {
          const form = racer.page.locator('form', { has: racer.page.locator(`input[name="slotId"][value="${target.id}"]`) })
          const button = form.getByRole('button', { name: /add to basket/i })
          if (!(await button.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false))) return
          await button.click().catch(() => {})
          await racer.page.waitForLoadState('networkidle').catch(() => {})
        }),
      )

      // Then all three check out at the same moment.
      await Promise.all(
        racers.map(async (racer) => {
          await racer.page.goto(`${agent.baseUrl}/g/${racer.token}/basket`).catch(() => {})
          const checkout = racer.page.getByRole('button', { name: /complete simulated checkout/i })
          if (!(await checkout.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false))) return
          await checkout.click().catch(() => {})
          await racer.page.waitForLoadState('networkidle').catch(() => {})
        }),
      )

      const after = await context.request.get(`${agent.baseUrl}/api/e2e/slot-state?experienceSlug=${slug}`, { failOnStatusCode: false })
      const afterState = (await after.json()) as SlotState
      const row = afterState.slots.find((s) => s.id === target.id)

      await agent.check('no-oversell-under-race', 'blocker', 'Three simultaneous buyers cannot push booked + held past capacity.', async () => {
        if (!afterState.invariantHolds) return 'the inventory invariant is violated: booked + held exceeds capacity on at least one departure'
        return row === undefined
          ? held('invariant holds (the raced departure is no longer listed)')
          : held(`invariant holds — ${row.booked} booked + ${row.held} held of ${row.capacity}`)
      })

      await agent.check('race-produces-no-5xx', 'major', 'A losing racer gets a refusal, not a server error.', async () => {
        const errors = agent.problems.filter((p) => p.kind === 'http-5xx')
        return errors.length === 0 ? true : errors.map((e) => e.detail).join('; ').slice(0, 400)
      })

      for (const racer of racers) await racer.ctx.close()
    })

    await agent.step('tampering with a form', async () => {
      // The price and the slot are server-side facts. The form carries ids, so
      // the probe is: change the quantity to something absurd and the slot to
      // one belonging to a different experience, and see what the service does.
      await page.goto(`${agent.baseUrl}/g/${mine}/experience/carrizalillo-beginner-surf-lesson`)
      const form = page.locator('form', { has: page.locator('input[name="slotId"]') }).first()
      if (!(await form.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false))) {
        agent.skip('quantity-tamper-refused', 'blocker', 'An absurd quantity is refused rather than held.', 'No add-to-basket form to tamper with.')
        return
      }
      const slug = 'carrizalillo-beginner-surf-lesson'
      const readState = async (): Promise<SlotState> => {
        const r = await context.request.get(`${agent.baseUrl}/api/e2e/slot-state?experienceSlug=${slug}`, { failOnStatusCode: false })
        return (await r.json()) as SlotState
      }
      const before = await readState()
      await agent.check('quantity-tamper-refused', 'blocker', 'A party of 9999 cannot be held — judged on the counters, not on the copy.', async () => {
        await form.evaluate((node) => {
          const el = node as HTMLFormElement
          let qty = el.querySelector('input[name="quantity"], select[name="quantity"]') as HTMLInputElement | null
          if (qty === null) {
            qty = document.createElement('input')
            qty.name = 'quantity'
            qty.type = 'hidden'
            el.appendChild(qty)
          }
          qty.value = '9999'
        })
        await form.getByRole('button', { name: /add to basket/i }).click()
        await page.waitForLoadState('networkidle').catch(() => {})
        const after = await readState()
        if (!after.invariantHolds) return 'a party of 9999 broke the inventory invariant'
        const heldBefore = before.slots.reduce((n, x) => n + x.held, 0)
        const heldAfter = after.slots.reduce((n, x) => n + x.held, 0)
        const grew = heldAfter - heldBefore
        if (grew > 20) return `held grew by ${grew} places on a tampered quantity of 9999`
        return held(`invariant holds; held places changed by ${grew}`)
      })
    })

    await agent.step('injecting a script through a field a person owns', async () => {
      await agent.signInAsDemo('elena@casaolas.demo', '/owner/property')
      const payload = `<img src=x onerror="window.__arcPressureTestXss=1">`
      const tagline = page.getByLabel('Tagline')
      if (!(await tagline.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false))) {
        agent.skip('stored-xss-escaped', 'blocker', 'Markup typed into a profile field is rendered as text, not executed.', 'No tagline field on the property page.')
        return
      }
      const original = await tagline.inputValue().catch(() => '')
      await tagline.fill(payload)
      await page.getByRole('button', { name: /save profile/i }).click()
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.reload()
      await agent.check('stored-xss-escaped', 'blocker', 'Markup typed into a profile field is stored and rendered as text, not executed.', async () => {
        const executed = await page.evaluate(() => '__arcPressureTestXss' in window).catch(() => false)
        if (executed) return 'the injected handler ran — stored XSS'
        const value = await page.getByLabel('Tagline').inputValue().catch(() => '')
        return held(value.includes('onerror') ? 'stored verbatim and rendered as text, not executed' : `stored as "${value.slice(0, 120)}"`)
      })
      // Put it back: the readout should not leave a hostile string in the demo.
      await page.getByLabel('Tagline').fill(original.length > 0 ? original : 'Twenty rooms above the western coves')
      await page.getByRole('button', { name: /save profile/i }).click()
      await page.waitForLoadState('networkidle').catch(() => {})
    })

    await agent.step('absurd money', async () => {
      await page.goto(`${agent.baseUrl}/owner/catalog/new`)
      await page.getByLabel('Activity type').selectOption({ index: 1 }).catch(() => {})
      await page.getByLabel('Partner').selectOption({ index: 1 }).catch(() => {})
      await page.getByLabel('Title (English)').fill(`Money edge ${Date.now()}`).catch(() => {})
      await agent.check('negative-price-refused', 'blocker', 'A negative price is refused at the form edge.', async () => {
        await page.getByLabel('Price per person (MXN)').fill('-500')
        await page.getByRole('button', { name: /save draft/i }).click()
        await page.waitForLoadState('networkidle').catch(() => {})
        await page.waitForTimeout(800)
        if (/\/owner\/catalog\/[0-9a-f-]{36}/.test(page.url())) {
          const shown = await page.getByLabel('Price per person (MXN)').inputValue().catch(() => '')
          return `a draft was created with a negative price; the editor reads "${shown}"`
        }
        const message = await page.locator('[role="alert"], [role="status"], .text-red-700').first().innerText().catch(() => '')
        return held(message.length > 0 ? `refused: ${message.replace(/\s+/g, ' ').slice(0, 160)}` : 'refused — the form did not submit and no draft was created')
      })
      await agent.check('fractional-centavo-refused', 'major', 'A price with sub-centavo precision cannot create a rounding difference (money is integer minor units).', async () => {
        await page.goto(`${agent.baseUrl}/owner/catalog/new`)
        await page.getByLabel('Activity type').selectOption({ index: 1 }).catch(() => {})
        await page.getByLabel('Partner').selectOption({ index: 1 }).catch(() => {})
        await page.getByLabel('Title (English)').fill(`Fraction edge ${Date.now()}`).catch(() => {})
        await page.getByLabel('Price per person (MXN)').fill('850.005')
        await page.getByRole('button', { name: /save draft/i }).click()
        await page.waitForLoadState('networkidle').catch(() => {})
        if (/\/owner\/catalog\/[0-9a-f-]{36}/.test(page.url())) {
          const stored = await page.getByLabel('Price per person (MXN)').inputValue().catch(() => '')
          // Accepting it is only a problem if the stored figure is not a whole
          // number of centavos, which is what the editor reads back.
          const minor = Math.round(Number(stored) * 100)
          return Number.isFinite(minor) && Math.abs(Number(stored) * 100 - minor) < 1e-9
            ? held(`accepted and stored as ${stored} MXN = ${minor} centavos exactly`)
            : `accepted and stored as ${stored} MXN, which is not a whole number of centavos`
        }
        const message = await page.locator('[role="alert"], [role="status"], .text-red-700').first().innerText().catch(() => '')
        return held(message.length > 0 ? `refused: ${message.replace(/\s+/g, ' ').slice(0, 160)}` : 'refused at the form edge')
      })
    })

    await agent.step('guessing at the admin surface', async () => {
      // Signed in as the owner, not an admin.
      const probe = await agent.asMe('/admin')
      await agent.check('owner-cannot-reach-admin', 'blocker', 'An owner session cannot reach /admin.', async () => {
        if (probe.status >= 400) return held(`HTTP ${probe.status}`)
        const body = probe.body.toLowerCase()
        if (body.includes('only route to a verified status') || body.includes('claimed, not confirmed')) {
          return `HTTP ${probe.status} and the verification queue rendered for an owner`
        }
        return held(`HTTP ${probe.status}, and none of the admin surface's own content came back`)
      })
    })
  },
}

export default persona
