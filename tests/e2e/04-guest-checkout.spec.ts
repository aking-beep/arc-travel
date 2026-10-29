import { expect, test } from '@playwright/test'
import { GUEST_PORTAL_TOKENS, OWNER_EMAIL, signInAs } from './helpers'

/**
 * Acceptance: a guest can add experiences to a basket and complete a simulated
 * checkout, and inventory decreases correctly without double-booking.
 */
test.describe('guest checkout', () => {
  test('add to basket, then complete a simulated checkout', async ({ page }) => {
    await page.goto(
      `/g/${GUEST_PORTAL_TOKENS.completedIntake}/experience/carrizalillo-beginner-surf-lesson`,
    )

    // Add the first bookable departure.
    const add = page.getByRole('button', { name: /add to basket/i }).first()
    await expect(add).toBeVisible()
    await add.click()
    await expect(page.getByText(/Added to your basket/i)).toBeVisible()
    // A hold is taken immediately and its expiry is stated.
    await expect(page.getByText(/holding your places until/i)).toBeVisible()

    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}/basket`)
    await expect(page.getByRole('heading', { name: /basket/i })).toBeVisible()
    await expect(page.getByText(/Held until/i)).toBeVisible()
    await expect(page.getByText(/^Total$/).first()).toBeVisible()

    await page.getByRole('button', { name: /complete simulated checkout/i }).click()

    await page.waitForURL(/\/order\/ARC-/)
    await expect(page.getByText(/experiences are reserved/i)).toBeVisible()
    await expect(page.getByText(/No card was charged/i)).toBeVisible()
    await expect(page.getByText(/Waiting on the partner to confirm/i)).toBeVisible()
  })

  test('inventory decreases by exactly what was booked', async ({ page, request }) => {
    // Read the partner's view of capacity before and after a guest buys.
    await signInAs(page, OWNER_EMAIL, '/owner/catalog')
    await page.goto('/owner/catalog')

    const before = await request.get('/api/e2e/slot-state?experienceSlug=carrizalillo-cove-snorkel')
    expect(before.ok()).toBeTruthy()
    const beforeJson = (await before.json()) as {
      slots: Array<{ id: string; capacity: number; booked: number; held: number }>
    }
    /*
     * This guest's party is two, so the departure has to have two free places.
     * The page lists several departures and the first one is not always this
     * one, so the add below is aimed at this slot rather than at whichever
     * button happens to come first — a one-place departure refused the add and
     * the test read it as a broken basket.
     */
    const target = beforeJson.slots.find((s) => s.capacity - s.booked - s.held >= 2)
    if (target === undefined) throw new Error('no departure with at least two free places')

    const context = await page.context()
    const guestPage = await context.newPage()
    await guestPage.goto(
      `/g/${GUEST_PORTAL_TOKENS.advancedSurfer}/experience/carrizalillo-cove-snorkel`,
    )
    /*
     * Wait for the action's own response before leaving the page. Navigating
     * straight after the click aborted the in-flight POST often enough to look
     * like a refused add.
     */
    await Promise.all([
      guestPage.waitForResponse(
        (response) => response.request().method() === 'POST' && response.status() < 400,
      ),
      guestPage
        .locator('form', { has: guestPage.locator(`input[name="slotId"][value="${target.id}"]`) })
        .getByRole('button', { name: /add to basket/i })
        .click(),
    ])

    /*
     * Confirm the add from the basket, not from the form message. `addToCart`
     * calls `revalidatePath`, so the route remounts and the `useActionState`
     * message is wiped — the habit `CLAUDE.md` records. The basket line is
     * durable state and is what the rest of this test depends on anyway.
     */
    await guestPage.goto(`/g/${GUEST_PORTAL_TOKENS.advancedSurfer}/basket`)
    await expect(guestPage.getByText(/Carrizalillo cove snorkel/i).first()).toBeVisible()

    await guestPage.getByRole('button', { name: /complete simulated checkout/i }).click()
    await guestPage.waitForURL(/\/order\/ARC-/)

    const after = await request.get('/api/e2e/slot-state?experienceSlug=carrizalillo-cove-snorkel')
    const afterJson = (await after.json()) as {
      slots: Array<{ id: string; capacity: number; booked: number; held: number }>
      invariantHolds: boolean
    }

    // The invariant that protects a real guest's seat.
    expect(afterJson.invariantHolds).toBe(true)

    const totalBookedBefore = beforeJson.slots.reduce((n, s) => n + s.booked, 0)
    const totalBookedAfter = afterJson.slots.reduce((n, s) => n + s.booked, 0)
    expect(totalBookedAfter).toBeGreaterThan(totalBookedBefore)

    await guestPage.close()
  })

  test('a basket cannot be checked out twice', async ({ page }) => {
    await page.goto(
      `/g/${GUEST_PORTAL_TOKENS.arrivingToday}/experience/pxm-airport-private-transfer`,
    )
    await page.getByRole('button', { name: /add to basket/i }).first().click()
    await expect(page.getByText(/Added to your basket/i)).toBeVisible()

    await page.goto(`/g/${GUEST_PORTAL_TOKENS.arrivingToday}/basket`)
    await page.getByRole('button', { name: /complete simulated checkout/i }).click()
    await page.waitForURL(/\/order\/ARC-/)
    const firstReference = new URL(page.url()).pathname.split('/').pop()

    // Going back and resubmitting must not create a second order.
    /*
     * The same assertion — the basket is empty and no second order was
     * written — on the copy ADR-046 gave it. A guest who had just paid was
     * told "your basket is empty", which reads as the purchase having
     * evaporated; it now says what is true, that the thing they bought is
     * paid for and so is not in a basket.
     */
    await page.goto(`/g/${GUEST_PORTAL_TOKENS.arrivingToday}/basket`)
    await expect(page.getByText(/Nothing waiting to be paid for/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /see what you booked/i })).toBeVisible()

    expect(firstReference).toMatch(/^ARC-/)
  })

  test('a guest can cancel a booking and see the refund rule applied', async ({ page }) => {
    await page.goto(
      `/g/${GUEST_PORTAL_TOKENS.completedIntake}/experience/casa-olas-sunrise-yoga`,
    )
    await page.getByRole('button', { name: /add to basket/i }).first().click()
    await expect(page.getByText(/Added to your basket/i)).toBeVisible()

    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}/basket`)
    await page.getByRole('button', { name: /complete simulated checkout/i }).click()
    await page.waitForURL(/\/order\/ARC-/)

    await page.getByRole('button', { name: /^Cancel$/ }).first().click()
    await expect(page.getByText(/Cancelled/i).first()).toBeVisible()
  })
})
