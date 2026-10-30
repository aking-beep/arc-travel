import { expect, test } from '@playwright/test'
import { switchLocale } from './helpers'

/**
 * Acceptance: the public destination surface.
 *
 * These journeys assert on durable state — a heading, a day list, a figure, a
 * row on the saved page — rather than on transient UI. The two habits recorded
 * in the specs apply here as everywhere: a server action that revalidates
 * remounts the route and resets `useActionState`, and the locale action
 * redirects to the same path so `waitForURL` resolves before the cookie lands,
 * which is why the language assertions go through `switchLocale`.
 *
 * What is deliberately *not* asserted is availability, a price quote or a
 * verified partner, because this surface has none of those to show.
 */
test.describe('the public surface', () => {
  test('a visitor can browse experiences and see every listing marked unverified', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    await page.goto('/experiences')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // Non-negotiable 2: /admin is the only route to a verified status, and
    // nothing in this build has been through it.
    await expect(page.getByText(/unverified listing/i).first()).toBeVisible()
    await expect(page.getByText(/verified partner/i)).toHaveCount(0)
  })

  test('an experience shows an estimate that moves with the party, never a quote', async ({
    page,
  }) => {
    await page.goto('/experiences')

    const firstCard = page.locator('a[href^="/experiences/"]').first()
    await firstCard.click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const more = page.getByRole('button', { name: /more travellers/i })
    await expect(more).toBeVisible()

    await expect(page.getByText(/^For \d+ (person|people)$/).first()).toBeVisible()

    const before = await page.locator('body').innerText()
    await more.click()
    // The figure is derived from the party size, so the page text must change.
    await expect
      .poll(async () => (await page.locator('body').innerText()) !== before)
      .toBe(true)

    // Every figure in a demo build carries its marker, and none of them is an
    // offer on a date.
    await expect(page.getByText('Demo').first()).toBeVisible()
  })

  test('the planner drafts a plan, names its generator and keeps it in the browser', async ({
    page,
  }) => {
    await page.goto('/plan')

    await page.getByRole('button', { name: /draft the journey/i }).click()

    // Durable state: the day list, not a transient message.
    await expect(page.getByRole('button', { name: /^1/ }).first()).toBeVisible()

    // Non-negotiable 5: a deterministic engine may not pass itself off as a model.
    await expect(page.getByText(/not a live model/i)).toBeVisible()

    await page.getByRole('button', { name: /keep in this browser/i }).click()

    await page.goto('/trips')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // The itinerary survived the navigation, which is the only persistence
    // this surface has: no account, no hold, nothing sent to ARC.
    await expect(page.getByText(/days in/i).first()).toBeVisible()
  })

  test('re-drafting at a different pace changes the plan', async ({ page }) => {
    await page.goto('/plan')
    await page.getByRole('button', { name: /draft the journey/i }).click()

    const firstDay = page.getByRole('button', { name: /^1/ }).first()
    await expect(firstDay).toBeVisible()

    const before = await page.locator('article').first().innerText()
    await page.getByRole('button', { name: 'Full', exact: true }).click()
    await expect
      .poll(async () => (await page.locator('article').first().innerText()) !== before)
      .toBe(true)
  })

  test('the header clears the demo banner on the hero, and nowhere else', async ({ page }) => {
    /*
     * The nav lives in the layout, so the node survives a client navigation
     * and an inline `top` written on one route outlives the trip to the next.
     *
     * On `/` the header is fixed over the hero photograph and the banner is
     * in flow above it, so it has to offset itself by the banner or draw
     * ivory controls on cream — nine of them, at a contrast ratio of 1.04,
     * which is what `10-accessibility` caught. Everywhere else it is
     * `sticky top-0`, and a leftover offset makes the bar stick a banner's
     * height below the top of the viewport.
     */
    await page.goto('/')
    const banner = page.locator('[data-demo-banner]')
    const header = page.locator('header').first()
    const bannerBottom = (await banner.boundingBox())?.height ?? 0
    expect(bannerBottom).toBeGreaterThan(0)
    expect((await header.boundingBox())?.y).toBeCloseTo(bannerBottom, 0)

    // Client-side, as a visitor would: the offset must not come with it.
    await page.getByRole('link', { name: 'Experiences', exact: true }).first().click()
    await page.waitForURL('**/experiences')
    await expect(header).toHaveCSS('top', '0px')
  })

  test('a question the guide offers is answered by the editors who wrote it', async ({ page }) => {
    /*
     * Mexico City's own chip is "Is it safe to walk around?", and the guide
     * panel's refusal guard matches the word "safe". Sent through the guard,
     * the chip returned the generic borders-and-health refusal and the
     * hand-written answer — which opens by refusing to call anywhere safe and
     * then says what is actually true — was thrown away.
     *
     * An exact prepared question is answered from the notes and never reaches
     * the model. The refusal still applies to anything typed.
     */
    await page.goto('/culture/mexico-city')
    await page.getByRole('button', { name: 'Is it safe to walk around?' }).click()

    await expect(page.getByText(/ARC does not tell anybody a place is safe/i)).toBeVisible()
    await expect(page.getByText(/is editorial writing, last read through/i)).toHaveCount(0)
  })

  test('no local guide calls anything safe, in any destination', async ({ page }) => {
    /*
     * Every destination, not just the one this demo is set in.
     *
     * It checked Puerto Escondido alone, and the bespoke guides ADR-046 wrote
     * for the other seven were never looked at: Lisbon and Ericeira both said
     * "tap water is safe to drink", and Chamonix said "ARC does not tell
     * anybody a route is safe" — a refusal, but the string is the string, and
     * the guide panel's own subtitle was reworded for exactly that reason. A
     * guard that covers one of eight pages is a guard that passes by luck.
     *
     * The FAQ *answers* still refuse in these words, and should: they are
     * rendered only when somebody asks, which is what this reads the loaded
     * page rather than the content module to allow.
     */
    for (const slug of [
      'puerto-escondido',
      'mexico-city',
      'lombok',
      'bali',
      'lisbon',
      'ericeira',
      'chamonix',
      'cape-town',
    ]) {
      await page.goto(`/culture/${slug}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

      const body = await page.locator('body').innerText()
      // Non-negotiable 1. The gate returns "allowed"; editorial copy may not
      // quietly promise what the gate refuses to.
      expect(body, slug).not.toMatch(/\bis safe\b|\bsafe to swim\b|\bsafe today\b/i)
    }
  })

  test('the surface is readable in Spanish', async ({ page }) => {
    await page.goto('/experiences')
    // The locale action redirects to the same path, so wait on html[lang].
    await switchLocale(page, 'es')
    await expect(page.getByText(/sin verificar/i).first()).toBeVisible()
    await switchLocale(page, 'en')
  })
})
