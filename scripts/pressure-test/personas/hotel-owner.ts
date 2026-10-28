/**
 * Elena — owner of Casa Olas, twenty rooms, no chain behind her.
 *
 * What she actually does on a Tuesday: reads the morning briefing, checks who
 * is arriving, approves what needs approving, looks at what the hotel earned,
 * and puts something new in the catalogue. She has no patience for a blank
 * panel and no way to tell "nothing today" from "this is broken".
 */
import { held, type Agent, type PersonaModule } from '../agent.js'
import { describe, safetyClaims } from '../claims.js'

const OWNER_EMAIL = 'elena@casaolas.demo'

const persona: PersonaModule = {
  id: 'hotel-owner',
  name: 'Elena — hotel owner',
  goal: 'Run the property for a day: briefing, arrivals, approvals, revenue, and publish something new.',

  async run(agent: Agent) {
    const { page } = agent

    await agent.step('sign in', async () => {
      await agent.signInAsDemo(OWNER_EMAIL, '/owner')
      await agent.check('owner-dashboard-loads', 'blocker', 'Signing in lands on her own property.', async () => {
        const heading = await page.getByRole('heading', { name: 'Casa Olas', level: 1 }).waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false)
        return heading || (await agent.text()).includes('casa olas')
      })
      await agent.check('demo-marker-present', 'major', 'Every surface says it is a demonstration environment.', () =>
        agent.visible(/Demonstration environment/i),
      )
    })

    await agent.step('morning briefing', async () => {
      await page.goto(`${agent.baseUrl}/owner/briefing`)
      const text = await agent.text()
      await agent.check('briefing-renders', 'major', 'The briefing renders something she can act on.', async () =>
        text.length > 200 ? held(`${text.length} characters of briefing`) : `only ${text.length} characters`,
      )
      await agent.check('briefing-no-safety-claim', 'blocker', 'Nothing on the briefing calls conditions safe.', async () => {
        const claims = safetyClaims(await page.locator('body').innerText())
        return claims.length === 0 ? true : describe(claims)
      })
      await agent.check('briefing-states-empty-or-content', 'minor', 'A panel with nothing in it says so rather than going blank.', async () => {
        const panels = await page.locator('section, article').count()
        const blank = await page.locator('section:empty, article:empty').count()
        return blank === 0 ? held(`${panels} panels, none empty`) : `${blank} of ${panels} panels render nothing at all`
      })
    })

    await agent.step('arrivals', async () => {
      await page.goto(`${agent.baseUrl}/owner/arrivals`)
      await agent.check('arrivals-renders', 'major', 'She can see who is arriving.', async () => {
        const t = await agent.text()
        return t.includes('arriv') || t.includes('no one') ? true : t.slice(0, 300)
      })
      await agent.check('arrivals-excludes-direct-trips', 'major', 'A direct customer with no room never reads as a room booking (ADR-042).', async () => {
        const t = await agent.text()
        // A direct trip has no room type; if arrivals shows one with a room
        // control the ADR is broken. Looked for by the word rather than a
        // selector so a renamed component still gets read.
        return t.includes('direct') && t.includes('check in') ? 'a direct trip appears with a check-in control' : true
      })
    })

    await agent.step('approvals', async () => {
      await page.goto(`${agent.baseUrl}/owner/approvals`)
      const t = await agent.text()
      await agent.check('approvals-renders', 'major', 'Pending proposals are listed with what they would do.', async () =>
        t.length > 150 ? true : `page is ${t.length} characters`,
      )
      // Approve the first thing offered, if anything is: an approval is the
      // product's whole answer to autonomy, so it has to work.
      const approve = page.getByRole('button', { name: /^(approve|approve and send|approve it)/i }).first()
      if (await approve.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)) {
        await approve.click()
        await page.waitForLoadState('networkidle').catch(() => {})
        await agent.check('approval-executes', 'major', 'Approving a proposal records the decision and does something.', async () => {
          const after = await agent.text()
          return after.includes('approved') || after.includes('sent') || after.includes('done')
            ? true
            : after.slice(0, 400)
        })
      } else {
        agent.skip('approval-executes', 'major', 'Approving a proposal records the decision and does something.', 'No pending proposal was offered to approve.')
      }
    })

    await agent.step('revenue', async () => {
      await page.goto(`${agent.baseUrl}/owner/revenue`)
      const t = await agent.text()
      await agent.check('revenue-renders', 'major', 'The revenue page shows figures.', async () => (t.includes('$') ? true : t.slice(0, 300)))
      await agent.check('revenue-no-safety-claim', 'minor', 'Nothing on the revenue page makes a safety claim.', async () => {
        const claims = safetyClaims(await page.locator('body').innerText())
        return claims.length === 0 ? true : describe(claims)
      })
      await agent.check('revenue-earned-and-potential-separated', 'blocker', 'Earned revenue and potential value are never summed or adjacent (ADR-007).', async () => {
        // The specific shape the ADR forbids: one total containing both.
        const bad = /(total|combined)[^.\n]{0,40}(potential|pipeline)/.exec(t)
        return bad === null ? true : `found "${bad[0]}"`
      })
      /*
       * `DemoFigure` renders a badge reading "Demo" beside the number — there
       * is no attribute to look for, so the badge text is the marker. The rule
       * in CLAUDE.md is a marker on every *headline* figure and none inside a
       * table, so a page of money with no badge at all is the failure.
       */
      await agent.check('revenue-headline-figures-marked', 'minor', 'Headline money on the revenue page carries the Demo marker.', async () => {
        const badges = await page.getByText('Demo', { exact: true }).count()
        const figures = (t.match(/\$[\d,]+/g) ?? []).length
        if (badges > 0) return held(`${badges} Demo badges against ${figures} money figures`)
        return `${figures} money figures on the revenue page and not one Demo marker`
      })
    })

    await agent.step('publish a new experience', async () => {
      await page.goto(`${agent.baseUrl}/owner/catalog/new`)
      const stamp = Date.now()
      const title = `Pressure test paddle ${stamp}`

      await page.getByLabel('Activity type').selectOption({ label: 'SURF — Beginner surf lesson' })
      await page.getByLabel('Partner').selectOption({ label: 'Escuela Olas Verdes (unverified)' })
      await page.getByLabel('Title (English)').fill(title)
      await page.getByLabel('One-line summary (English)').fill('Two hours on the water at golden hour.')
      await page.getByLabel('Description (English)').fill('Created by the persona pressure test. Soft-top boards, sheltered cove, two hours.')
      await page.getByLabel('Meeting point').fill('Top of the Carrizalillo stairway')
      await page.getByLabel('Price per person (MXN)').fill('850')
      await page.getByLabel('Capacity per departure').fill('5')
      await page.getByRole('button', { name: /save draft/i }).click()

      const landed = await page
        .waitForURL(/\/owner\/catalog\/[0-9a-f-]{36}/, { timeout: 25_000 })
        .then(() => true)
        .catch(() => false)

      await agent.check('draft-created', 'blocker', 'She can create a draft experience.', async () =>
        landed ? true : `stayed on ${page.url()}`,
      )
      if (!landed) return

      await agent.check('publish-blocked-without-departure', 'major', 'Publishing is refused until there is something to sell.', async () => {
        const disabled = await page.getByRole('button', { name: /^Publish$/ }).isDisabled().catch(() => false)
        return disabled ? true : 'the Publish button was enabled with no departures'
      })

      // A departure outside the activity's own hours must be refused.
      const day = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10)
      await page.getByLabel('Date').fill(day)
      await page.getByLabel('Start', { exact: true }).fill('16:30')
      await page.getByLabel('Capacity', { exact: true }).fill('5')
      await page.getByRole('button', { name: /add departure/i }).click()
      await agent.check('operating-window-enforced-on-create', 'major', 'A departure outside the activity hours is refused at creation (ADR-029).', () =>
        agent.visible(/departs between/i, 12_000),
      )

      /*
       * The whole row again, not just the hour: the action calls
       * `revalidatePath`, the route remounts, and the fields it had are gone.
       * And the success has to be waited for — reloading while the POST is in
       * flight loses the departure and reads as a product that will not
       * publish, which is exactly how this probe lied the first time it ran.
       */
      await page.getByLabel('Date').fill(day)
      await page.getByLabel('Start', { exact: true }).fill('15:00')
      await page.getByLabel('Capacity', { exact: true }).fill('5')
      await page.getByRole('button', { name: /add departure/i }).click()
      const departureAdded = await agent.visible(/Departure added/i, 20_000)
      if (!departureAdded) agent.note('The "Departure added" confirmation never appeared, so the publish check below may be reading a listing with no departures.')
      await page.reload()

      const publish = page.getByRole('button', { name: /^Publish$/ })
      await agent.check('publish-now-possible', 'blocker', 'With a departure in place she can publish.', async () => {
        if (!(await publish.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false))) return 'no Publish button'
        if (await publish.isDisabled().catch(() => true)) return `still disabled: ${(await agent.text()).slice(0, 300)}`
        await publish.click()
        await page.waitForLoadState('networkidle').catch(() => {})
        const t = await agent.text()
        return t.includes('published') || t.includes('guests can see it now') ? true : t.slice(0, 400)
      })

      agent.note(`Published a listing titled "${title}" — demo data, left in place deliberately so the readout can be re-checked.`)
    })

    await agent.step('partners', async () => {
      await page.goto(`${agent.baseUrl}/owner/partners`)
      const t = await agent.text()
      await agent.check('partners-claims-are-claims', 'blocker', 'A partner’s certifications are rendered as claims, not as checks ARC made.', async () => {
        if (t.includes('certifications below are claims') || t.includes('claims the partner made') || t.includes('what they say about themselves')) return true
        return t.slice(0, 500)
      })
      await agent.check('partners-unverified-stated', 'blocker', 'Fixture partners read as not verified.', async () =>
        t.includes('not verified') ? true : t.slice(0, 400),
      )
      await agent.check('owner-cannot-verify', 'blocker', 'No control on the owner surface can award verification (/admin only).', async () => {
        const buttons = await page.getByRole('button', { name: /^verif|mark as verified|verify/i }).count()
        return buttons === 0 ? true : `${buttons} verification-looking controls on the owner surface`
      })
    })

    await agent.step('payouts and messages', async () => {
      for (const route of ['/owner/payouts', '/owner/messages', '/owner/guests']) {
        await page.goto(`${agent.baseUrl}${route}`)
        const t = await agent.text()
        await agent.check(`loads${route.replace(/\//g, '-')}`, 'major', `${route} renders for the owner.`, async () =>
          t.length > 80 && !t.includes('application error') ? true : t.slice(0, 300),
        )
      }
    })
  },
}

export default persona
