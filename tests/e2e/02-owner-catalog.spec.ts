import { expect, test } from '@playwright/test'
import { OWNER_EMAIL, dateKeyDaysFromNow, signInAs } from './helpers'

/**
 * Acceptance: an owner can publish an experience with a price and capacity.
 *
 * Also covers the rule that makes the catalog trustworthy: the ability range is
 * clamped into the activity's safety envelope, and publishing is blocked until
 * the preconditions are met.
 */
test.describe('owner catalog', () => {
  test('creating a draft, adding a departure, then publishing', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner/catalog/new')

    const title = `Sunset paddle board session ${Date.now()}`

    // The activity carries the safety rules, so it is chosen first.
    await page.getByLabel('Activity type').selectOption({ label: 'SURF — Beginner surf lesson' })
    await expect(page.getByText(/Beginner surf lesson constraints/)).toBeVisible()
    await expect(page.getByText(/certified guide is mandatory/)).toBeVisible()

    await page.getByLabel('Partner').selectOption({ label: 'Escuela Olas Verdes (unverified)' })
    await page.getByLabel('Title (English)').fill(title)
    await page.getByLabel('One-line summary (English)').fill('Two hours on the water at golden hour.')
    await page.getByLabel('Description (English)').fill(
      'A test experience created by the acceptance suite. Two hours, soft-top boards, in the sheltered cove.',
    )
    await page.getByLabel('Meeting point').fill('Top of the Carrizalillo stairway')
    await page.getByLabel('Price per person (MXN)').fill('850')
    await page.getByLabel('Capacity per departure').fill('5')

    await page.getByRole('button', { name: /save draft/i }).click()

    // Lands on the editor for the new draft.
    await page.waitForURL(/\/owner\/catalog\/[0-9a-f-]{36}/)
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await expect(page.getByText('DRAFT', { exact: true })).toBeVisible()

    // Publishing is blocked until there is a departure to sell.
    await expect(page.getByText(/Add at least one departure/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Publish$/ })).toBeDisabled()

    await page.getByLabel('Date').fill(dateKeyDaysFromNow(6))
    await page.getByLabel('Start', { exact: true }).fill('16:30')
    await page.getByLabel('Capacity', { exact: true }).fill('5')
    await page.getByRole('button', { name: /add departure/i }).click()
    await expect(page.getByText(/Departure added/i)).toBeVisible()

    await page.reload()
    await expect(page.getByText(/Everything required is in place/)).toBeVisible()

    await page.getByRole('button', { name: /^Publish$/ }).click()
    await expect(page.getByText(/Guests can see it now/i)).toBeVisible()
    await expect(page.getByText('PUBLISHED').first()).toBeVisible()
  })

  test('the ability range cannot be widened past the activity’s envelope', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner/catalog/new')

    const title = `Clamp test ${Date.now()}`

    // The Zicatela guided session is ADVANCED–EXPERT only.
    await page.getByLabel('Activity type').selectOption({ label: 'SURF — Zicatela guided session' })
    await expect(page.getByText(/ADVANCED to EXPERT/)).toBeVisible()

    await page.getByLabel('Partner').selectOption({ label: 'Punta Surf Collective (unverified)' })
    await page.getByLabel('Title (English)').fill(title)
    await page.getByLabel('Price per person (MXN)').fill('2100')

    // Try to sell it to beginners anyway.
    await page.getByLabel('Minimum ability').selectOption('BEGINNER')
    await page.getByRole('button', { name: /save draft/i }).click()

    await page.waitForURL(/\/owner\/catalog\/[0-9a-f-]{36}/)

    // The service clamped it and the editor reflects the clamped value.
    await expect(page.getByLabel('Minimum ability')).toHaveValue('ADVANCED')
  })

  test('the catalog lists amenities that cannot be sold yet', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner/catalog')

    await expect(page.getByText(/amenities are not sellable yet/)).toBeVisible()
    await expect(page.getByText('Loaner soft-top boards')).toBeVisible()
    await expect(page.getByRole('link', { name: /make it sellable/i }).first()).toBeVisible()
  })
})
