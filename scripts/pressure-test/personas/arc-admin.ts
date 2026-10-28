/**
 * The ARC admin — the only person in the product who can award a verification,
 * and therefore the person the product's honesty rests on.
 *
 * This persona deliberately does **not** verify a partner. The seeded partners
 * are UNVERIFIED by design (non-negotiable 2), and an agent awarding a badge
 * nobody checked is exactly the thing the badge exists to rule out. What it
 * does instead is push on the refusals: verify with nothing recorded, verify
 * insurance with no expiry date, and publish an advisory as law.
 */
import { held, type Agent, type PersonaModule } from '../agent.js'

const ADMIN_EMAIL = 'admin@arctravel.demo'

const persona: PersonaModule = {
  id: 'arc-admin',
  name: 'ARC admin — verification and health',
  goal: 'Work the verification queue, read system health, and confirm the refusals hold.',

  async run(agent: Agent) {
    const { page } = agent

    await agent.step('sign in', async () => {
      await agent.signInAsDemo(ADMIN_EMAIL, '/admin')
      await agent.check('admin-loads', 'blocker', 'The admin surface loads for an admin.', async () => {
        const heading = await page.getByRole('heading', { name: /verification/i, level: 1 }).waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false)
        return heading ? true : `${page.url()} — ${(await agent.text()).slice(0, 300)}`
      })
      await agent.check('admin-states-sole-route', 'major', 'The page says it is the only route to a verified status.', () =>
        agent.visible(/only route to a verified status/i),
      )
    })

    await agent.step('the queue is honest about the demo', async () => {
      const t = await agent.text()
      /*
       * Scoped to the Partners section. The page also carries a property card,
       * and counting badges across the whole page conflated the two — the
       * property is a separate question, asked next.
       */
      await agent.check('fixture-partners-unverified', 'blocker', 'No seeded partner is verified (non-negotiable 2).', async () => {
        const partners = page.locator('section', { has: page.getByRole('heading', { name: 'Partners' }) })
        const badges = await partners.getByText('verified', { exact: true }).count()
        return badges === 0 ? held('every partner card reads unverified, pending or rejected') : `${badges} partner cards read as verified`
      })
      /*
       * And the one the copy above makes a claim about: "Nothing is verified by
       * a seed". The seed writes `verification: VERIFIED` on the property.
       */
      await agent.check('nothing-verified-by-a-seed', 'major', 'Nothing in the demo holds a VERIFIED status that no admin awarded — the page says so in as many words.', async () => {
        const body = await page.locator('body').innerText()
        const claim = /Nothing is verified by a seed/i.test(body)
        const propertySection = page.locator('section', { has: page.getByRole('heading', { name: /propert/i }) })
        const propertyVerified = (await propertySection.getByText('verified', { exact: true }).count()) > 0
        if (!claim) return held('the page does not make that claim, so there is nothing to contradict')
        return propertyVerified
          ? 'the page states "Nothing is verified by a seed" while the seeded property card reads verified — prisma/seed.ts writes VerificationStatus.VERIFIED on the property'
          : held('the claim holds on this page')
      })
      await agent.check('claims-marked-as-claims', 'blocker', 'Claimed certifications are headed as claims.', async () =>
        t.includes('claimed, not confirmed') || t.includes('partner’s own statements') ? true : t.slice(0, 400),
      )
      await agent.check('unverified-but-selling-is-flagged', 'major', 'An unverified partner already selling is called out.', async () =>
        t.includes('already selling from this unverified partner') ? true : 'no warning about unverified partners with live listings',
      )
      await agent.check('insurance-state-is-stated', 'major', 'Each partner card says whether insurance is on file.', async () => {
        const onFile = (t.match(/not on file/g) ?? []).length
        return t.includes('insurance') ? held(`insurance stated; "not on file" appears ${onFile} times`) : 'no insurance line on the partner cards'
      })
    })

    await agent.step('verification refuses what was not checked', async () => {
      const form = page.locator('form:has(button:has-text("Verify"))').first()
      if (!(await form.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false))) {
        agent.skip('verify-refuses-empty-checklist', 'blocker', 'Verifying with nothing recorded is refused.', 'No verification form on the page.')
        return
      }
      // Clear every check and submit: the service must refuse.
      const boxes = form.locator('input[type="checkbox"]')
      const n = await boxes.count()
      for (let i = 0; i < n; i += 1) await boxes.nth(i).uncheck().catch(() => {})
      await form.getByRole('button', { name: /verify/i }).first().click()
      await page.waitForLoadState('networkidle').catch(() => {})

      await agent.check('verify-refuses-empty-checklist', 'blocker', 'Verifying a partner with no checks recorded is refused with a reason (ADR-036).', async () => {
        const t = await agent.text()
        if (/record what you actually checked|every required check|refus/i.test(t)) return true
        const stillUnverified = (await page.getByText('verified', { exact: true }).count()) === 0
        return stillUnverified ? 'refused silently — nothing was verified, but no reason was shown' : 'a partner was verified with an empty checklist'
      })
    })

    await agent.step('an advisory is not law', async () => {
      await page.goto(`${agent.baseUrl}/admin/destination`)
      const t = await agent.text()
      if (t.includes('advisory')) {
        await agent.check('advisory-labelled-advisory', 'blocker', 'A government advisory is labelled as advice, not as law (ADR-024).', async () => {
          const bad = /law[^.\n]{0,60}advisory|advisory[^.\n]{0,20}\bis law\b/.exec(t)
          return bad === null ? held('advisory content present and not framed as law') : `found "${bad[0]}"`
        })
      } else {
        agent.observe('advisory-labelled-advisory', 'A government advisory is labelled as advice, not as law (ADR-024).', 'No advisory content on the destination page in this seed, so there was nothing to judge.')
      }
      // The claim lives on /admin, where the review queue is.
      await page.goto(`${agent.baseUrl}/admin`)
      await agent.check('source-change-is-a-review-item', 'major', 'A changed source is queued for review rather than published (ADR-024).', async () => {
        const body = (await page.locator('body').innerText()).toLowerCase()
        return body.includes('does not mean the rules changed') || body.includes('waiting for review') || body.includes('no changes detected')
          ? true
          : body.slice(0, 400)
      })
      await page.goto(`${agent.baseUrl}/admin/destination`)
    })

    await agent.step('system health', async () => {
      await page.goto(`${agent.baseUrl}/admin/health`)
      const t = await agent.text()
      await agent.check('health-page-loads', 'major', 'The health page reports the state of the data.', async () => (t.length > 200 ? true : t.slice(0, 300)))
      await agent.check('health-names-failing-invariants', 'major', 'Health reports each invariant by name rather than one green light.', async () => {
        const rows = await page.locator('li, tr').count()
        return rows > 3 ? held(`${rows} reported rows`) : `only ${rows} rows`
      })
      const failing = /\b(fail|violat|breach)\w*/i.exec(t)
      if (failing !== null) agent.note(`The health page reports something failing: "${t.slice(Math.max(0, failing.index - 80), failing.index + 160)}"`)
    })

    await agent.step('the machine endpoints', async () => {
      const health = await agent.anonymous('/api/health')
      await agent.check('api-health-is-terse-for-strangers', 'major', 'An anonymous caller learns almost nothing from /api/health (ADR-037).', async () => {
        const body = health.body.toLowerCase()
        const leaks = ['database_url', 'postgres', 'prisma', 'stack', 'at /home/'].filter((s) => body.includes(s))
        return leaks.length === 0 ? held(`HTTP ${health.status}, ${health.body.length} bytes: ${health.body.slice(0, 120)}`) : `leaks: ${leaks.join(', ')}`
      })

      /*
       * POST, not GET. These routes export only `POST`, so a GET returns 405
       * whatever the authorisation says — the first version of this probe
       * proved nothing at all.
       */
      for (const route of ['/api/cron/sweep-holds', '/api/cron/check-invariants', '/api/cron/dispatch-email']) {
        const response = await agent.context.request.post(`${agent.baseUrl}${route}`, { failOnStatusCode: false, headers: { 'content-type': 'application/json' }, data: {} })
        const status = response.status()
        const body = (await response.text().catch(() => '')).slice(0, 300)
        await agent.check(
          `cron-closed${route.replace(/\//g, '-')}`,
          'blocker',
          `A POST to ${route} with no credential does nothing.`,
          async () => (status === 401 || status === 403 || status === 404 ? held(`HTTP ${status}`) : `HTTP ${status}: ${body}`),
        )
        await agent.check(
          `cron-wrong-secret-refused${route.replace(/\//g, '-')}`,
          'blocker',
          `A POST to ${route} with a wrong secret does nothing.`,
          async () => {
            const wrong = await agent.context.request.post(`${agent.baseUrl}${route}`, {
              failOnStatusCode: false,
              headers: { authorization: 'Bearer not-the-cron-secret', 'content-type': 'application/json' },
              data: {},
            })
            const s2 = wrong.status()
            return s2 === 401 || s2 === 403 || s2 === 404 ? held(`HTTP ${s2}`) : `HTTP ${s2}: ${(await wrong.text().catch(() => '')).slice(0, 200)}`
          },
        )
      }
    })
  },
}

export default persona
