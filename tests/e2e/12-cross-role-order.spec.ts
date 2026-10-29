import { expect, test } from '@playwright/test'
import { GUEST_PORTAL_TOKENS, OWNER_EMAIL, PARTNER_EMAIL, parseMoney, signInAs } from './helpers'

/**
 * Acceptance: one guest purchase, followed by name through every role that is
 * supposed to see it — and refused to the one that is not.
 *
 * The other specs each prove one surface works. None of them proved the
 * surfaces agree about a *particular* order, which is the question an operator
 * actually asks: "the guest says ARC-1234, where is it?" Each role here is
 * asserted against the reference the guest was given, not against a count that
 * a seeded row could satisfy.
 *
 * `carrizalillo-beginner-surf-lesson` is Escuela Olas Verdes', which is
 * `PARTNER_EMAIL`'s business — the chain only closes if the booking lands with
 * the partner who has to deliver it.
 */
test.describe('one order across every role', () => {
  test('a guest purchase reaches the partner, the hotel ledger and nobody else', async ({
    page,
  }) => {
    const token = GUEST_PORTAL_TOKENS.completedIntake

    // ---- The hotel's figures before the purchase, so the movement is this
    // order's and not the seed's.
    await signInAs(page, OWNER_EMAIL, '/owner/briefing')
    const earnedBefore = parseMoney(
      await page.getByText(/Your share of \d+ orders confirmed since/).first().innerText(),
    )
    await page.goto('/owner/payouts')
    const heldBeforeText = await page.getByText(/^HELD BACK$|Held back/i).first().innerText()
    expect(heldBeforeText.length).toBeGreaterThan(0)

    // ---- The guest buys.
    await page.context().clearCookies()
    await page.goto(`/g/${token}/experience/carrizalillo-beginner-surf-lesson`)
    const add = page.getByRole('button', { name: /add to basket/i }).first()
    await expect(add).toBeVisible()
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && r.status() < 400),
      add.click(),
    ])

    // Durable state, not the form message: `addToCart` revalidates the route.
    await page.goto(`/g/${token}/basket`)
    await expect(page.getByText(/First waves at Carrizalillo/i).first()).toBeVisible()
    await page.getByRole('button', { name: /complete simulated checkout/i }).click()
    await page.waitForURL(/\/order\/ARC-/)

    const reference = new URL(page.url()).pathname.split('/').pop()
    expect(reference).toMatch(/^ARC-/)
    if (reference === undefined) throw new Error('no order reference')
    /*
      * `.first()`: the seed and the earlier specs leave this guest with other
      * unconfirmed lines, and the whole suite running in order is the case
      * that matters. The reference assertions below are what pin this test to
      * *this* order.
      */
    await expect(page.getByText(/Waiting on the partner to confirm/i).first()).toBeVisible()

    // ---- The partner who has to deliver it sees it, by reference, as work
    // outstanding.
    await signInAs(page, PARTNER_EMAIL, '/partner/bookings')
    await expect(page.getByRole('heading', { name: /needs your confirmation/i })).toBeVisible()
    await expect(page.getByText(reference).first()).toBeVisible()

    /*
     * And it is not yet in what they are owed: an unconfirmed booking is money
     * nobody has earned. The page has to say so rather than quietly omitting
     * it.
     */
    await page.goto('/partner/earnings')
    await expect(page.getByText(/waiting on your confirmation/i)).toBeVisible()
    await expect(page.getByText(reference)).toHaveCount(0)

    // ---- The hotel sees the same line, held back, and its own share counted.
    await signInAs(page, OWNER_EMAIL, '/owner/payouts')
    await expect(page.getByText(/held back/i).first()).toBeVisible()
    await expect(page.getByText(/Escuela Olas Verdes/).first()).toBeVisible()

    /*
     * And the hotel can find it from the reference alone, which is what a
     * guest actually reads down the phone. This is the one operator screen the
     * reference appears on, so it is asserted here rather than left to the
     * integration test.
     */
    await page.goto(`/owner/lookup?ref=${reference}`)
    await expect(page.getByText(reference).first()).toBeVisible()
    await expect(
      page.getByText(/Waiting on Escuela Olas Verdes to confirm/i).first(),
    ).toBeVisible()

    await page.goto('/owner/briefing')
    const earnedAfter = parseMoney(
      await page.getByText(/Your share of \d+ orders confirmed since/).first().innerText(),
    )
    // The hotel's share of this order, counted the moment the guest paid.
    expect(earnedAfter).toBeGreaterThan(earnedBefore)

    // ---- Another partner must not be able to see it at all. Tenant isolation
    // proven on a row that definitely exists, rather than on an empty page.
    await signInAs(page, 'diego@puntasurf.demo', '/partner/bookings')
    await expect(page.getByText(reference)).toHaveCount(0)
    await page.goto('/partner/earnings')
    await expect(page.getByText(reference)).toHaveCount(0)

    // ---- The partner confirms, and the guest's own page says so.
    await signInAs(page, PARTNER_EMAIL, '/partner/bookings')
    /*
     * The card holding this reference, not the first Confirm button on the
     * page: the seed leaves other bookings outstanding and confirming one of
     * those would prove nothing about this order. Ancestors come first in DOM
     * order, so the last match is the innermost card.
     */
    const row = page
      .locator('div')
      .filter({ hasText: reference })
      .filter({ has: page.getByRole('button', { name: /^Confirm$/ }) })
      .last()
    await row.getByRole('button', { name: /^Confirm$/ }).click()
    await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible()

    await page.context().clearCookies()
    await page.goto(`/g/${token}/order/${reference}`)
    await expect(page.getByText(/Confirmed by the partner/i).first()).toBeVisible()

    // And the desk's own lookup says the same thing, from the same row.
    await signInAs(page, OWNER_EMAIL, `/owner/lookup?ref=${reference}`)
    await expect(page.getByText(/Confirmed by Escuela Olas Verdes/i).first()).toBeVisible()
  })
})
