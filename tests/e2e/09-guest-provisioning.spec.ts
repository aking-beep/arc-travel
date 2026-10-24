import { expect, test } from '@playwright/test'
import { OWNER_EMAIL, signInAs } from './helpers'

/**
 * Step five of the commercial journey, which had no route at all: the desk
 * creates a stay, gets a portal link, and the guest opens it.
 *
 * Asserted end to end rather than on a form message, because the link is the
 * whole point — a message saying a stay was created proves nothing if the
 * portal it mints does not open.
 */
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

const dateKeyDaysFromNow = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

test.describe('guest provisioning', () => {
  test('creating a stay mints a portal link that opens the guest portal', async ({ page }) => {
    const lastName = `Okonjo-${unique()}`

    await signInAs(page, OWNER_EMAIL, '/owner/guests')

    await page.getByLabel('First name').fill('Harriet')
    await page.getByLabel('Last name').fill(lastName)
    await page.getByLabel('Email').fill(`harriet-${unique()}@example.com`)
    await page.getByLabel('Check-in').fill(dateKeyDaysFromNow(0))
    await page.getByLabel('Check-out').fill(dateKeyDaysFromNow(4))
    await page.getByRole('button', { name: /create the stay/i }).click()

    // Durable state: the stay is in the list with its own link. Scoped to this
    // guest's card — the seeded stays are listed too, and sort before it.
    const card = page.getByTestId('stay-card').filter({ hasText: lastName })
    await expect(card).toBeVisible()
    const token = (await card.getByTestId('portal-token').textContent())
      ?.trim()
      .replace('/g/', '')
    expect(token).toBeTruthy()

    // The guest opens it with no account of any kind.
    await page.context().clearCookies()
    await page.goto(`/g/${token}`)
    await expect(page.getByText('Harriet', { exact: false }).first()).toBeVisible()
  })

  test('issuing a new link stops the old one working', async ({ page }) => {
    const lastName = `Ferrer-${unique()}`

    await signInAs(page, OWNER_EMAIL, '/owner/guests')
    await page.getByLabel('First name').fill('Mateo')
    await page.getByLabel('Last name').fill(lastName)
    await page.getByLabel('Email').fill(`mateo-${unique()}@example.com`)
    await page.getByLabel('Check-in').fill(dateKeyDaysFromNow(1))
    await page.getByLabel('Check-out').fill(dateKeyDaysFromNow(5))
    await page.getByRole('button', { name: /create the stay/i }).click()

    const card = page.getByTestId('stay-card').filter({ hasText: lastName })
    await expect(card).toBeVisible()

    const firstToken = (await card.getByTestId('portal-token').textContent())
      ?.trim()
      .replace('/g/', '')
    expect(firstToken).toBeTruthy()

    // Reissue from that stay's own card.
    await card.getByRole('button', { name: /issue a new link/i }).click()
    await expect(page.getByText(/previous link stopped working/i)).toBeVisible()

    await page.context().clearCookies()
    const response = await page.goto(`/g/${firstToken}`)
    // The old token resolves nothing: the portal 404s.
    expect(response?.status()).toBe(404)
  })
})

test.describe('commission administration', () => {
  test('a new rule changes what a sale would split', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner/revenue/commission')

    await expect(page.getByRole('heading', { name: /^commission$/i })).toBeVisible()
    // The preview exists and comes from the live resolver.
    await expect(page.getByText(/what a sale would split today/i)).toBeVisible()

    await page.getByLabel('Your share (%)').last().fill('27.5')
    await page.getByLabel('ARC share (%)').last().fill('5')
    await page.getByRole('button', { name: /add the rule/i }).click()

    await expect(page.getByText(/27\.5%/).first()).toBeVisible()
  })

  test('shares adding up to more than the gross are refused', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner/revenue/commission')

    await page.getByLabel('Your share (%)').last().fill('80')
    await page.getByLabel('ARC share (%)').last().fill('40')
    await page.getByRole('button', { name: /add the rule/i }).click()

    await expect(page.getByText(/more than 100% of gross/i)).toBeVisible()
  })
})
