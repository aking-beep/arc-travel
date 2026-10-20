import { expect, test } from '@playwright/test'
import { GUEST_PORTAL_TOKENS } from './helpers'

/**
 * Acceptance: a guest can build a feasible, personalised itinerary.
 *
 * Also covers the two things that make the plan trustworthy: every item shows
 * its reasoning, and ocean readings appear with the time they were taken.
 */
test.describe('guest itinerary', () => {
  test('a guest who has completed intake can build a plan with visible reasoning', async ({
    page,
  }) => {
    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}`)

    await expect(page.getByRole('heading', { name: 'Casa Olas', level: 1 })).toBeVisible()
    await expect(page.getByText(/Demonstration environment/i)).toBeVisible()

    // No plan yet, so the build controls are offered.
    const build = page.getByRole('button', { name: /build my itinerary|rebuild itinerary/i })
    await expect(build).toBeVisible()
    await build.click()

    // The plan renders with days and per-item reasoning.
    await expect(page.getByRole('heading', { name: /day plan/i })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { name: /^Day 1/ })).toBeVisible()

    const why = page.getByText('Why this').first()
    await expect(why).toBeVisible()
    await why.click()
    // Reasons are deterministic sentences, not model prose.
    await expect(page.getByText(/minutes from the hotel|here for|budget|low risk/i).first()).toBeVisible()
  })

  test('ocean readings always carry their timestamp and source', async ({ page }) => {
    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}/guide`)

    await expect(page.getByRole('heading', { name: /ocean conditions/i })).toBeVisible()
    await expect(page.getByText(/Reading taken/).first()).toBeVisible()
    await expect(page.getByText(/ARC demo fixture/).first()).toBeVisible()

    // The product states conditions; it never asserts safety.
    await expect(
      page.getByText(/it cannot tell you a beach is safe/i).first(),
    ).toBeVisible()
  })

  test('the guide shows provenance for every place', async ({ page }) => {
    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}/guide`)

    await expect(page.getByText('Playa Zicatela').first()).toBeVisible()
    await expect(page.getByText(/Mexican Pipeline/)).toBeVisible()
    await expect(page.getByText(/seed fixture/).first()).toBeVisible()
    await expect(page.getByText(/Unverified/).first()).toBeVisible()
  })

  test('intake refuses to proceed without data-processing consent', async ({ page }) => {
    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}/intake`)

    await expect(page.getByRole('heading', { name: /a few questions/i })).toBeVisible()

    // The consent checkbox is required, so the browser blocks submission and
    // the page does not navigate.
    await page.getByRole('button', { name: /build my itinerary/i }).click()
    await expect(page).toHaveURL(/\/intake$/)
  })

  test('a guest can record preferences and get them used', async ({ page }) => {
    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}/intake`)

    await page.getByLabel('Surf experience').selectOption('BEGINNER')
    await page.getByLabel('Preferred pace').selectOption('RELAXED')
    await page.getByLabel('Daily budget per person').fill('1500')
    await page.getByRole('checkbox', { name: /I agree to ARC Stay processing/ }).check()
    await page
      .getByRole('checkbox', { name: /Use my answers to personalise/ })
      .check()

    await page.getByRole('button', { name: /build my itinerary/i }).click()
    await page.waitForURL(/\/g\/[^/]+\?intake=done/)

    // Back on the portal home, the build controls now default to what was saved.
    await expect(page.getByLabel('Preferred pace')).toHaveValue('RELAXED')
  })

  test('an experience page states what is unverified rather than implying approval', async ({
    page,
  }) => {
    await page.goto(
      `/g/${GUEST_PORTAL_TOKENS.completedIntake}/experience/carrizalillo-beginner-surf-lesson`,
    )

    await expect(page.getByRole('heading', { name: /First waves at Carrizalillo/ })).toBeVisible()
    await expect(page.getByText(/Unverified/).first()).toBeVisible()
    await expect(
      page.getByText(/what they told us, not what we confirmed/i),
    ).toBeVisible()
    // The activity's own safety note is surfaced before booking.
    await expect(page.getByText(/Before you book/)).toBeVisible()
  })
})

test.describe('suitability at the point of booking', () => {
  test('a beginner is refused the advanced-only session, with the reason', async ({ page }) => {
    // The experience page is a route to a booking that does not pass through
    // the itinerary. It used to render an Add-to-basket button for every
    // departure without consulting the safety gate at all, so a beginner could
    // open the Zicatela session and buy it.
    await page.goto(
      `/g/${GUEST_PORTAL_TOKENS.completedIntake}/experience/zicatela-guided-advanced-session`,
    )

    await expect(
      page.getByRole('heading', { name: /Zicatela guided session/ }),
    ).toBeVisible()

    // No way to buy it.
    await expect(page.getByRole('button', { name: /add to basket/i })).toHaveCount(0)
    await expect(page.getByText(/Not bookable for you/).first()).toBeVisible()

    // And the reason is stated rather than hidden behind "unavailable".
    await expect(
      page.getByText(/experience or above|demands|does not run above/i).first(),
    ).toBeVisible()
  })

  test('the same guest can still book what suits them', async ({ page }) => {
    await page.goto(
      `/g/${GUEST_PORTAL_TOKENS.completedIntake}/experience/carrizalillo-beginner-surf-lesson`,
    )

    await expect(page.getByRole('button', { name: /add to basket/i }).first()).toBeVisible()
  })

  test('ocean readings carry their disclaimer on the booking screen too', async ({ page }) => {
    // The compact card used to drop the disclaimer and the rip-current notes,
    // and the only screens that passed `compact` were the ones with a buy
    // button — so a guest saw the warning only on pages that sell nothing.
    await page.goto(
      `/g/${GUEST_PORTAL_TOKENS.completedIntake}/experience/carrizalillo-beginner-surf-lesson`,
    )

    await expect(page.getByText(/Conditions for/).first()).toBeVisible()
    await expect(page.getByText(/Reading taken/).first()).toBeVisible()
    await expect(
      page.getByText(/it cannot tell you a beach is safe/i).first(),
    ).toBeVisible()
  })
})
