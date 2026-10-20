import { expect, test } from '@playwright/test'
import { PARTNER_EMAIL, dateKeyDaysFromNow, signInAs } from './helpers'

/**
 * Acceptance: a supplier can manage availability and see a simulated booking.
 */
test.describe('partner portal', () => {
  test('partner sees only their own business and its verification state', async ({ page }) => {
    await signInAs(page, PARTNER_EMAIL, '/partner')

    await expect(page.getByRole('heading', { name: 'Escuela Olas Verdes', level: 1 })).toBeVisible()
    await expect(page.getByText(/Not yet verified by ARC/)).toBeVisible()
    await expect(page.getByText(/Payouts are off for every partner/)).toBeVisible()

    // They see what they are owed, never the hotel's share.
    await expect(page.getByText(/Owed to you \(simulated\)/)).toBeVisible()
  })

  test('partner schedules availability in bulk', async ({ page }) => {
    await signInAs(page, PARTNER_EMAIL, '/partner/availability')

    await page.getByLabel('Experience').selectOption({ index: 1 })
    await page.getByLabel('From').fill(dateKeyDaysFromNow(25))
    await page.getByLabel('To').fill(dateKeyDaysFromNow(27))
    await page.getByLabel('Start times').fill('11:15, 14:45')
    await page.getByLabel('Places per departure').fill('4')

    await page.getByRole('button', { name: /add departures/i }).click()
    await expect(page.getByText(/departures added/i)).toBeVisible()

    // Re-running the same schedule is harmless rather than an error.
    await page.getByLabel('Experience').selectOption({ index: 1 })
    await page.getByLabel('From').fill(dateKeyDaysFromNow(25))
    await page.getByLabel('To').fill(dateKeyDaysFromNow(27))
    await page.getByLabel('Start times').fill('11:15, 14:45')
    await page.getByLabel('Places per departure').fill('4')
    await page.getByRole('button', { name: /add departures/i }).click()
    await expect(page.getByText(/already exist|were skipped/i).first()).toBeVisible()
  })

  test('partner sees held and booked capacity separately', async ({ page }) => {
    await signInAs(page, PARTNER_EMAIL, '/partner/availability')

    await expect(page.getByRole('heading', { name: 'Availability', level: 1 })).toBeVisible()
    await expect(page.getByText(/“Held” means a guest has places in their basket/)).toBeVisible()
    await expect(page.getByText(/booked/).first()).toBeVisible()
  })

  test('partner confirms a booking by hand', async ({ page }) => {
    await signInAs(page, PARTNER_EMAIL, '/partner/bookings')

    await expect(page.getByRole('heading', { name: /booking requests/i })).toBeVisible()
    await expect(page.getByText(/You confirm each one by hand/)).toBeVisible()

    const unconfirmedHeading = page.getByRole('heading', { name: /needs your confirmation/i })
    await expect(unconfirmedHeading).toBeVisible()

    const confirm = page.getByRole('button', { name: /^Confirm$/ }).first()
    if (!(await confirm.isVisible().catch(() => false))) {
      // Every booking is already confirmed, which is a valid state to be in.
      await expect(page.getByText(/Nothing outstanding/)).toBeVisible()
      return
    }

    const outstandingBefore = await page.getByRole('button', { name: /^Confirm$/ }).count()
    await confirm.click()

    // Assert on the durable state, not the form's transient message: the
    // action revalidates the route, which remounts the form and resets it.
    await expect(page.getByRole('button', { name: /^Confirm$/ })).toHaveCount(
      outstandingBefore - 1,
    )
    await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible()
  })

  test('partner earnings report only what the partner is owed', async ({ page }) => {
    await signInAs(page, PARTNER_EMAIL, '/partner/earnings')

    await expect(page.getByRole('heading', { name: 'Earnings', level: 1 })).toBeVisible()
    await expect(page.getByText(/after the hotel’s share and ARC’s commission/)).toBeVisible()
    await expect(page.getByText(/Payouts are disabled/)).toBeVisible()

    // No hotel-side figure appears anywhere on a partner page.
    await expect(page.getByText(/hotel earnings/i)).toHaveCount(0)
  })
})
