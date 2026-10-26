import { expect, test, type Page } from '@playwright/test'
import { GUEST_PORTAL_TOKENS } from './helpers'

/**
 * Acceptance: a guest can sign up and see their own stay (ADR-039).
 *
 * Before this, a guest's only way in was the QR code — unrecoverable, and
 * showing one stay even when they had three. The journey asserted here is the
 * one that actually converts: from inside the portal they already hold, where
 * the token is the proof and the form asks for a name and a password.
 *
 * Asserted on durable state throughout — the bookings list, the property name,
 * the booking reference — rather than on a form message, which
 * `revalidatePath` resets.
 *
 * The seeded guest used here is Harriet Okonjo, whose `User` the seed creates
 * with no password. Signing up takes that placeholder over, which is the case
 * that matters: it is the shape every desk-created guest is in.
 */
const PASSWORD = 'an entirely ordinary passphrase'
const TOKEN = GUEST_PORTAL_TOKENS.completedIntake
const GUEST_EMAIL = 'harriet.okonjo@example.com'

/** The password form on `/sign-in`, scoped away from the demo switcher below it. */
const credentialsForm = (page: Page) => page.locator('form:has(input[name="password"])')

test.describe('guest account', () => {
  test('a guest signs up from their portal and lands on their own bookings', async ({ page }) => {
    await page.goto(`/g/${TOKEN}`)

    // The offer is on the portal's own home tab, because that is where the
    // person already is.
    const offer = page.getByRole('link', { name: /create a guest account/i })
    await expect(offer).toBeVisible()
    await offer.click()

    await page.waitForURL(new RegExp(`/g/${TOKEN}/account`))

    // The address is shown rather than asked for: it is the one the property
    // recorded, and the account will be keyed on it.
    await expect(page.getByText(GUEST_EMAIL)).toBeVisible()
    // And no reference field at all — the token behind the page is the proof.
    await expect(page.getByLabel(/booking reference/i)).toHaveCount(0)

    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Confirm password').fill(PASSWORD)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: /create the account/i }).click()

    // Signed in, on the account, looking at the stay they just proved.
    await page.waitForURL('/me')
    await expect(page.getByRole('heading', { name: /your bookings/i, level: 1 })).toBeVisible()
    await expect(page.getByText('Casa Olas').first()).toBeVisible()
    await expect(page.getByText(GUEST_EMAIL)).toBeVisible()

    // The portal link is offered while the stay is live, and it works.
    const openStay = page.getByRole('link', { name: /open your stay/i }).first()
    await expect(openStay).toBeVisible()
    await openStay.click()
    await expect(page.getByRole('heading', { name: 'Casa Olas', level: 1 })).toBeVisible()

    // The offer is gone now that somebody holds the account.
    await expect(page.getByRole('link', { name: /create a guest account/i })).toHaveCount(0)

    // The credential works on its own, from a clean session — which is the
    // whole point: no QR code needed.
    await page.context().clearCookies()
    await page.goto('/sign-in')
    const form = credentialsForm(page)
    await form.getByLabel('Email').fill(GUEST_EMAIL)
    await form.getByLabel('Password').fill(PASSWORD)
    await form.getByRole('button', { name: /sign in/i }).click()

    // A guest with no membership lands on their bookings, not on the home page.
    await page.waitForURL('/me')
    await expect(page.getByText('Casa Olas').first()).toBeVisible()
  })

  test('the cold form refuses a claim it cannot prove, and says nothing about why', async ({
    page,
  }) => {
    // Which of the two facts was wrong is deliberately not said — otherwise
    // the form answers "is that a real booking, and whose?". The pairing rules
    // themselves are proved properly in tests/integration/guest-account.test.ts,
    // against real references; this asserts the surface.
    await page.goto('/sign-up/guest')
    await page.getByLabel(/booking reference/i).fill('STAY-NOPE-NOPE')
    await page.getByLabel('Email', { exact: true }).fill('not-the-guest@example.com')
    await page.getByLabel('Your name').fill('A Stranger')
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Confirm password').fill(PASSWORD)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: /create the account/i }).click()

    // Scoped to the form's own alert: `getByRole('alert')` alone resolves to
    // Next's empty route announcer first.
    await expect(
      page.locator('form [role="alert"]').filter({ hasText: /do not match a current booking/i }),
    ).toBeVisible()
    // Still on the form, not signed in anywhere.
    await expect(page).toHaveURL(/\/sign-up\/guest/)
  })

  test('an anonymous visitor cannot reach the account surface', async ({ page }) => {
    await page.goto('/me')
    await page.waitForURL(/\/sign-in/)
    await expect(credentialsForm(page)).toBeVisible()
  })
})
