import { expect, test } from '@playwright/test'
import { dateKeyDaysFromNow, signOut } from './helpers'

/**
 * Acceptance: a stranger reads a property page and buys, in the application.
 *
 * The journey this covers did not exist. The property page ended at a link
 * into a demo portal, so the one surface somebody arrives on could not sell
 * anything, and every route into the guest surface started either at a front
 * desk or at a sign-up form — which asks people to create an account before
 * they have decided to buy anything.
 *
 * What it has to prove, in order: the portal link is gone, the departures are
 * real, the account arrives *at* the purchase and not before it, and the thing
 * they land on afterwards shows what they bought, when it happens and what it
 * cost. The one thing it must never show is a room sold by ARC — the panel
 * says availability lives with the hotel, and nothing here contradicts it.
 */
const PASSPHRASE = 'an entirely ordinary passphrase'

/** Inside the seeded availability horizon, which runs three weeks out. */
const FROM = dateKeyDaysFromNow(4)
const TO = dateKeyDaysFromNow(8)

test.describe('a visitor buying from the storefront', () => {
  test('goes from a property page to a paid order and an account', async ({ page }) => {
    await page.goto('/stays/casa-olas')

    // The portal demo is gone from the page somebody actually arrives on.
    await expect(page.getByRole('link', { name: /guest portal demo/i })).toHaveCount(0)

    await page.getByLabel('Arrive').fill(FROM)
    await page.getByLabel('Depart').fill(TO)
    await page.getByLabel(/your level in the water/i).selectOption('ADVANCED')
    await page.getByRole('button', { name: /plan and book this trip/i }).click()

    await page.waitForURL('**/book')
    await expect(page.getByRole('heading', { name: 'Your trip', level: 1 })).toBeVisible()
    // It says plainly that it is not selling a room.
    await expect(page.getByText(/does not hold their room calendar/i)).toBeVisible()

    // A real departure, with a real time on it.
    const departure = page.locator('button[name="slotId"]:not([disabled])').first()
    await expect(departure).toBeVisible()
    await departure.click()

    /*
     * Durable state, not the form message: the basket holds a line and offers
     * the way on. `revalidatePath` remounts the route and resets
     * `useActionState`.
     *
     * The till moved off this page in ADR-046. The basket used to end at the
     * payment form, which asked for a name, an address and a password beside
     * a catalogue six thousand pixels tall and never read the trip back. The
     * step between is `/book/review`.
     */
    const onward = page.getByRole('link', { name: /review and pay/i })
    await expect(onward).toBeVisible()
    await onward.click()
    await page.waitForURL('**/book/review')

    // The review step reads the trip back before anything is taken.
    await expect(page.getByRole('heading', { name: /review your trip/i })).toBeVisible()
    await expect(page.getByText(/does not hold their room calendar/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /pay and create my account/i })).toBeVisible()

    const email = `storefront.${Date.now()}@example.com`
    await page.getByLabel('Your name').fill('Noor Haddad')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Choose a password').fill(PASSPHRASE)
    await page.getByLabel('Confirm password').fill(PASSPHRASE)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: /pay and create my account/i }).click()

    // The order page: what they bought, signed in, with no further sign-up.
    await page.waitForURL(/\/me\/orders\/ARC-[A-Z0-9-]+$/)
    await expect(page.getByText(/paid\. this is what you bought/i)).toBeVisible()
    await expect(page.getByText(/awaiting the partner/i).first()).toBeVisible()

    // And the account holds the itinerary and the spend.
    await page.goto('/me')
    await expect(page.getByRole('heading', { name: /what you have spent/i })).toBeVisible()
    await expect(page.getByText('Your itinerary').first()).toBeVisible()
    // A storefront trip is a trip, never a room booking. ADR-042.
    await expect(page.getByText('Trip — no room booked').first()).toBeVisible()

    /*
     * The unpaid-trip notice, and the two things that must not show it.
     *
     * It is for one state only: a trip the till wrote and then failed to take
     * the payment for. A reference from the URL is matched against this
     * person's own stays, so a crafted link cannot put words on somebody's
     * account page; and the stay must have no order, because a reference is
     * printed on this very page — without that, anybody could paste the
     * reference of a trip they had *paid* for and be told nothing had been
     * charged for it.
     */
    await page.goto('/me?unpaid=ARC-NOT-A-REAL-REFERENCE')
    await expect(page.getByText(/it is not booked yet/i)).toHaveCount(0)

    await page.goto('/me')
    const paidReference = await page
      .locator('dt', { hasText: 'Reference' })
      .first()
      .locator('xpath=following-sibling::dd[1]')
      .innerText()
    expect(paidReference).toMatch(/\S/)
    await page.goto(`/me?unpaid=${encodeURIComponent(paidReference.trim())}`)
    await expect(page.getByText(/it is not booked yet/i)).toHaveCount(0)

    await signOut(page)
  })

  test('refuses a demanding departure while nobody has stated an ability', async ({ page }) => {
    await page.goto('/stays/casa-olas')
    await page.getByLabel('Arrive').fill(FROM)
    await page.getByLabel('Depart').fill(TO)
    // Deliberately no ability: the gate's strict case (ADR-017).
    await page.getByRole('button', { name: /plan and book this trip/i }).click()
    await page.waitForURL('**/book')

    /*
     * The advanced-only session is on the page and closed, with its reason.
     * Hiding it would answer "why can I not book this" with silence, and the
     * gate's reasons are the most useful thing this page says.
     */
    const advanced = page.getByText(/advanced only/i).first()
    await expect(advanced).toBeVisible()
    await expect(page.getByText(/tell us your experience level/i).first()).toBeVisible()
  })

  test('an illustrative listing offers no booking control at all', async ({ page }) => {
    // A content-set stay: no hotel behind it, no catalogue, no availability.
    await page.goto('/stays/ubud-sanctuary')

    await expect(page.getByRole('button', { name: /plan and book this trip/i })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /guest portal demo/i })).toHaveCount(0)
    await expect(page.getByText(/this listing is illustrative/i)).toBeVisible()
  })
})
