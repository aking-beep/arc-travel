import { expect, test } from '@playwright/test'
import { OWNER_EMAIL, dateKeyDaysFromNow, signInAs, signOut } from './helpers'

/**
 * Acceptance: somebody who is not staying anywhere can plan and buy.
 *
 * The journey this covers had no implementation at all — every route into the
 * guest surface started at a front desk — and the thing it has to prove twice
 * is that the result is *not* a room booking. See ADR-042.
 */
const PASSPHRASE = 'an entirely ordinary passphrase'

test.describe('a direct customer', () => {
  test('signs up with no booking reference and lands in the planner', async ({ page }) => {
    await page.goto('/sign-up/direct')

    await expect(page.getByRole('heading', { name: 'Plan a trip', level: 1 })).toBeVisible()
    await expect(page.getByText(/This books no accommodation/)).toBeVisible()
    // No booking reference anywhere: that is the other sign-up.
    await expect(page.getByLabel(/booking reference/i)).toHaveCount(0)

    await page.getByLabel('Where you want to book through').selectOption({ index: 1 })
    await page.getByLabel('First day').fill(dateKeyDaysFromNow(1))
    await page.getByLabel('Last day').fill(dateKeyDaysFromNow(3))
    await page.getByLabel('How many of you').fill('2')
    await page.getByLabel('Your name').fill('Sam Okafor')
    await page.getByLabel('Email').fill('sam.direct@example.com')
    await page.getByLabel('Password', { exact: true }).fill(PASSPHRASE)
    await page.getByLabel('Confirm password').fill(PASSPHRASE)
    await page.getByRole('checkbox').check()

    await page.getByRole('button', { name: /create the account and start planning/i }).click()

    // Straight into the portal, which is where planning happens.
    await page.waitForURL(/\/g\/[A-Za-z0-9_-]+$/)
    await expect(page.getByRole('link', { name: /explore|plan/i }).first()).toBeVisible()
  })

  test('their account calls it a trip and not a stay', async ({ page }) => {
    await page.goto('/sign-up/direct')
    await page.getByLabel('Where you want to book through').selectOption({ index: 1 })
    await page.getByLabel('First day').fill(dateKeyDaysFromNow(2))
    await page.getByLabel('Last day').fill(dateKeyDaysFromNow(4))
    await page.getByLabel('Your name').fill('Rosa Linares')
    await page.getByLabel('Email').fill('rosa.direct@example.com')
    await page.getByLabel('Password', { exact: true }).fill(PASSPHRASE)
    await page.getByLabel('Confirm password').fill(PASSPHRASE)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: /create the account and start planning/i }).click()
    await page.waitForURL(/\/g\/[A-Za-z0-9_-]+$/)

    await page.goto('/me')
    await expect(page.getByText('Trip — no room booked').first()).toBeVisible()
    // "Check-in" is a room word and must not appear for this person.
    await expect(page.getByText('First day').first()).toBeVisible()

    // And a second trip can be added from here.
    await page.getByLabel('Book through').selectOption({ index: 1 })
    await page.getByLabel('First day').last().fill(dateKeyDaysFromNow(20))
    await page.getByLabel('Last day').last().fill(dateKeyDaysFromNow(21))
    await page.getByRole('button', { name: /add the trip/i }).click()
    await expect(page.getByText(/Added\. Open it above/)).toBeVisible()

    // Durable state, not the form message: two trips on the page.
    await page.reload()
    await expect(page.getByText('Trip — no room booked')).toHaveCount(2)

    await signOut(page)
  })

  test('the hotel sees them as a direct booking, not an arrival', async ({ page }) => {
    await page.goto('/sign-up/direct')
    await page.getByLabel('Where you want to book through').selectOption({ index: 1 })
    await page.getByLabel('First day').fill(dateKeyDaysFromNow(1))
    await page.getByLabel('Last day').fill(dateKeyDaysFromNow(2))
    await page.getByLabel('Your name').fill('Tomas Vela')
    await page.getByLabel('Email').fill('tomas.direct@example.com')
    await page.getByLabel('Password', { exact: true }).fill(PASSPHRASE)
    await page.getByLabel('Confirm password').fill(PASSPHRASE)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: /create the account and start planning/i }).click()
    await page.waitForURL(/\/g\/[A-Za-z0-9_-]+$/)

    await signInAs(page, OWNER_EMAIL, '/owner/guests')

    const card = page.locator('div', { hasText: 'Tomas Vela' }).first()
    await expect(card).toBeVisible()
    await expect(page.getByText('Direct — no room').first()).toBeVisible()
    await expect(
      page.getByText(/Not an arrival — nobody is coming to the desk for a key/).first(),
    ).toBeVisible()

    // Not in arrivals, which is the list the desk works from.
    await page.goto('/owner/arrivals')
    await expect(page.getByText('Tomas Vela')).toHaveCount(0)

    await signOut(page)
  })
})
