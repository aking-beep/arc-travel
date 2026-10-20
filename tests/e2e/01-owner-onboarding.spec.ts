import { expect, test } from '@playwright/test'
import { OWNER_EMAIL, signInAs } from './helpers'

/**
 * Acceptance: a hotel owner can onboard Casa Olas and edit the property profile.
 */
test.describe('owner onboarding and property profile', () => {
  test('owner signs in and sees their property', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner')

    await expect(page.getByRole('heading', { name: 'Casa Olas', level: 1 })).toBeVisible()
    await expect(page.getByText(/20 rooms/)).toBeVisible()
    // Demo mode must be unmistakable on every surface.
    await expect(page.getByText(/Demonstration environment/i)).toBeVisible()
  })

  test('owner edits the property profile and the change persists', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner/property')

    const tagline = page.getByLabel('Tagline')
    await expect(tagline).toBeVisible()

    const updated = `Twenty rooms above the western coves · ${Date.now()}`
    await tagline.fill(updated)
    await page.getByRole('button', { name: /save profile/i }).click()

    await expect(page.getByText(/Property profile saved/i)).toBeVisible()

    // Reload to prove it was stored, not just echoed back.
    await page.reload()
    await expect(page.getByLabel('Tagline')).toHaveValue(updated)
  })

  test('onboarding progress is derived from stored facts', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner')

    // The seeded property is fully set up, so no setup card should appear.
    await expect(page.getByText(/^Setup · /)).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /next arrivals/i })).toBeVisible()
  })

  test('owner can add a room type and the derived total follows', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner/property')

    const code = `T${Date.now().toString().slice(-5)}`
    await page.getByLabel('Code').fill(code)
    await page.getByLabel('Name', { exact: true }).last().fill('Test Room')
    await page.getByLabel('Rooms of this type').fill('2')
    await page.getByLabel('Sleeps').fill('2')
    await page.getByLabel('Nightly rate (MXN)').fill('1500')
    await page.getByRole('button', { name: /save room type/i }).click()

    await expect(page.getByText(/Room type saved/i)).toBeVisible()
    // 20 seeded rooms plus the 2 just added.
    await expect(page.getByText(/22 rooms in total/)).toBeVisible()
  })

  test('owner sees the partner roster with unverified status stated plainly', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner/partners')

    await expect(page.getByRole('heading', { name: 'Partners', level: 1 })).toBeVisible()
    await expect(page.getByText('Escuela Olas Verdes').first()).toBeVisible()
    await expect(page.getByText(/Not verified by ARC/).first()).toBeVisible()
    await expect(
      page.getByText(/certifications below are claims the partner made/).first(),
    ).toBeVisible()
  })
})
