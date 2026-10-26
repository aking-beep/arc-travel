import { expect, test, type Page } from '@playwright/test'
import { OWNER_EMAIL, signInAs, signOut } from './helpers'

/**
 * Acceptance: the password-reset surface, and what it refuses to tell you
 * (ADR-040).
 *
 * The journey a real hotel hits in roughly its first week, and the one ARC
 * could not answer at all before transactional mail existed.
 *
 * **What is deliberately not asserted here, and why.** The full happy path —
 * follow the emailed link, set a password, sign in with it — needs the token,
 * and the only ways to get it are an inbox or a route that hands out reset
 * links. The second was written and then deleted: the hosted demo runs
 * `ARC_DATA_MODE=demo` and is open to anyone with the URL, so an endpoint
 * returning a reset link for an address would be a working account-takeover
 * endpoint on the internet, gated or not. An acceptance test is not worth
 * that. The whole path is covered at the service layer instead, against a real
 * database, in `tests/integration/transactional-email.test.ts` — single use,
 * expiry, supersession, the simultaneous-submission race, and the refusal of a
 * passwordless placeholder.
 *
 * What is asserted here is what only a browser can show: that the form gives
 * nothing away, that a bad token is refused without a hint, and that an owner
 * can read the mail ARC would have sent.
 *
 * Named `09c-` so it still runs *before* the accessibility audit, per ADR-038.
 */

/** The reset form, scoped away from anything else on the page. */
const resetForm = (page: Page) => page.locator('form:has(input[name="email"])')

const outcome = (page: Page) =>
  page.getByText(/reset link is on its way|cannot send email/i)

test.describe('asking for a password reset', () => {
  test('answers identically whether or not the address has an account', async ({ page }) => {
    await page.goto('/forgot-password')
    await resetForm(page)
      .getByLabel(/email/i)
      .fill('nobody-at-all@example.invalid')
    await page.getByRole('button', { name: /send the link/i }).click()

    await expect(outcome(page)).toBeVisible()
    const unknown = ((await outcome(page).textContent()) ?? '').trim()
    expect(unknown.length).toBeGreaterThan(0)

    await page.goto('/forgot-password')
    await resetForm(page)
      .getByLabel(/email/i)
      .fill(OWNER_EMAIL)
    await page.getByRole('button', { name: /send the link/i }).click()
    await expect(outcome(page)).toBeVisible()

    /*
     * Character for character. The accounts here are a named list of boutique
     * hotels and their partners, so a form that answered differently would
     * confirm which of them are ARC customers to anybody who asked it.
     */
    expect(((await outcome(page).textContent()) ?? '').trim()).toBe(unknown)
  })

  test('is reachable from sign-in, which is where somebody stuck actually is', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByRole('link', { name: /forgotten your password/i }).click()
    await page.waitForURL(/\/forgot-password/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/reset your password/i)
  })
})

test.describe('presenting a reset token', () => {
  test('refuses one that was never issued, without saying why', async ({ page }) => {
    await page.goto('/reset-password/definitely-not-a-real-token-value')

    await expect(page.getByText(/not valid any more/i)).toBeVisible()
    /*
     * No "expired", no "already used", no address. Unlike an invitation —
     * where the holder of the link is by definition the person it was sent to
     * and an accurate reason is help — a reset link may be presented by
     * whoever is reading a mailbox, and "this expired four minutes ago" tells
     * them a valid one recently existed.
     */
    await expect(page.getByText(/expired|already been used/i)).toHaveCount(0)
    // And it offers the way forward rather than a dead end.
    await expect(page.getByRole('link', { name: /reset your password/i })).toBeVisible()
  })

  test('shows no password fields for a token it refused', async ({ page }) => {
    await page.goto('/reset-password/another-token-nobody-ever-issued')
    await expect(page.locator('input[name="password"]')).toHaveCount(0)
  })
})

test.describe('the mail log', () => {
  test('tells an owner it delivers nothing, rather than implying mail works', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner/messages')

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/messages/i)

    /*
     * The demo records and sends nothing, and the page has to say so. A
     * surface that showed `Sent` badges on a deployment that delivers no mail
     * is the one failure mode this whole log exists to prevent.
     */
    await expect(page.getByText(/records messages and delivers none/i)).toBeVisible()

    // Empty is a legitimate state and must read as "nothing yet" rather than
    // as a broken panel.
    const empty = page.getByText(/no messages yet/i)
    const messages = page.locator('details')
    expect((await empty.count()) + (await messages.count())).toBeGreaterThan(0)

    await signOut(page)
  })

  test('is in the owner navigation, so it can be found without a url', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner')
    await page.getByRole('link', { name: /^messages$/i }).click()
    await page.waitForURL(/\/owner\/messages/)
    await signOut(page)
  })
})
