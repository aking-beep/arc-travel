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

  test('the local guide reports conditions without ever calling them safe', async ({ page }) => {
    await page.goto('/culture/puerto-escondido')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const body = await page.locator('body').innerText()
    // Non-negotiable 1. The gate returns "allowed"; editorial copy may not
    // quietly promise what the gate refuses to.
    expect(body).not.toMatch(/\bis safe\b|\bsafe to swim\b|\bsafe today\b/i)
  })

  test('the surface is readable in Spanish', async ({ page }) => {
    await page.goto('/experiences')
    // The locale action redirects to the same path, so wait on html[lang].
    await switchLocale(page, 'es')
    await expect(page.getByText(/sin verificar/i).first()).toBeVisible()
    await switchLocale(page, 'en')
  })
})
