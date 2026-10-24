import { expect, test } from '@playwright/test'
import { OWNER_EMAIL, signInAs } from './helpers'

/**
 * The two journeys the readiness audit found had no route at all: a hotel
 * signing itself up, and an invited partner taking over the account the hotel
 * created for them.
 *
 * Both are asserted on durable state — the dashboard that only exists for a
 * signed-in owner, the partner surface that only exists for a signed-in
 * partner — rather than on a form message, which `revalidatePath` resets.
 */
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

/**
 * The password form, scoped away from the demo switcher below it — that section
 * has a "Sign in" button per demo account.
 */
const credentialsForm = (page: import('@playwright/test').Page) =>
  page.locator('form:has(input[name="password"])')
const PASSWORD = 'an entirely ordinary passphrase'

test.describe('hotel sign-up', () => {
  test('registering creates a draft property and lands on the dashboard', async ({ page }) => {
    const email = `owner-${unique()}@example.com`
    const propertyName = `Casa Prueba ${unique()}`

    await page.goto('/sign-up')
    await page.getByLabel('Your name').fill('Ana Rivera')
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Confirm password').fill(PASSWORD)
    await page.getByLabel('Business name').fill(`Rivera Hoteles ${unique()}`)
    await page.getByLabel('Property name').fill(propertyName)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: /create the account/i }).click()

    // Signed in and on the owner dashboard, which anonymous visitors cannot see.
    await page.waitForURL(/\/owner/)
    await expect(page.getByText(propertyName).first()).toBeVisible()

    // And the credential works on its own, from a clean session.
    await page.context().clearCookies()
    await page.goto('/sign-in')
    const form = credentialsForm(page)
    await form.getByLabel('Email', { exact: true }).fill(email)
    await form.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await form.getByRole('button', { name: /^sign in$/i }).click()
    await page.waitForURL(/\/owner/)
    await expect(page.getByText(propertyName).first()).toBeVisible()
  })

  test('a wrong password is refused without saying which half was wrong', async ({ page }) => {
    await page.goto('/sign-in')
    const form = credentialsForm(page)
    await form.getByLabel('Email', { exact: true }).fill('nobody@example.com')
    await form.getByLabel('Password', { exact: true }).fill('not a real password')
    await form.getByRole('button', { name: /^sign in$/i }).click()

    await expect(page.getByText(/do not match an account/i)).toBeVisible()
  })
})

test.describe('partner invitation', () => {
  test('the owner gets a link, and the link gives the partner their own password', async ({
    page,
  }) => {
    const partnerEmail = `partner-${unique()}@example.com`
    const partnerName = `Olas de Prueba ${unique()}`

    await signInAs(page, OWNER_EMAIL, '/owner/partners')

    await page.getByLabel('Business name').fill(partnerName)
    await page.getByLabel('Contact person').fill('Luis Mendoza')
    await page.getByLabel('Contact email').fill(partnerEmail)
    // At least one category is required, so the form is submitted complete.
    await page.getByRole('checkbox', { name: /adventure/i }).check()
    await page.getByRole('button', { name: /add partner/i }).click()

    // The link is shown to the owner rather than emailed: outbound messaging
    // is off in this build, so "we have emailed them" would be false.
    const note = page.getByText(/\/invite\//)
    await expect(note).toBeVisible()
    const inviteUrl = (await note.textContent())?.match(/\/invite\/[A-Za-z0-9_-]+/)?.[0]
    expect(inviteUrl).toBeTruthy()

    // The partner follows it in their own session.
    await page.context().clearCookies()
    await page.goto(inviteUrl!)
    await expect(page.getByRole('heading', { name: /set your password/i })).toBeVisible()
    await page.getByLabel('Choose a password').fill(PASSWORD)
    await page.getByLabel('Confirm password').fill(PASSWORD)
    await page.getByRole('button', { name: /set my password/i }).click()

    await page.waitForURL(/\/partner/)
    await expect(page.getByText(partnerName).first()).toBeVisible()

    // The link is single-use.
    await page.context().clearCookies()
    await page.goto(inviteUrl!)
    await expect(page.getByText(/cannot be used/i)).toBeVisible()
  })
})
