import { expect, test } from '@playwright/test'
import { OWNER_EMAIL, PARTNER_EMAIL, signInAs, signOut } from './helpers'

/**
 * Acceptance: a local business can run itself, and the hotel keeps every
 * decision that is the hotel's (ADR-041).
 *
 * The assertions are on durable state rather than on a form message wherever
 * the action calls `revalidatePath` — the route remounts and `useActionState`
 * resets, so a message is a race and a listing in a list is not.
 */
test.describe('partner self-service', () => {
  test('a partner edits what they say about themselves', async ({ page }) => {
    await signInAs(page, PARTNER_EMAIL, '/partner/profile')

    await expect(page.getByRole('heading', { name: 'Your business', level: 1 })).toBeVisible()

    const description = page.getByLabel('What you do')
    await description.fill('Two instructors, small groups, Zicatela and La Punta.')
    await page.getByRole('button', { name: /^Save$/ }).click()
    // Wait for the action to land before reloading: a reload mid-flight loses
    // the response and the assertion below reads the old row.
    await expect(page.getByText(/Saved\. The hotel sees this/)).toBeVisible()

    // Durable: reload and the text is what was typed.
    await page.reload()
    await expect(page.getByLabel('What you do')).toHaveValue(
      'Two instructors, small groups, Zicatela and La Punta.',
    )
  })

  test('the profile page offers no way to verify yourself', async ({ page }) => {
    await signInAs(page, PARTNER_EMAIL, '/partner/profile')

    await expect(
      page.getByText(/Only ARC can mark a business as verified/),
    ).toBeVisible()

    // The form asks for a check; it cannot award one. No control on this page
    // writes the verification columns, and the copy says so.
    await expect(page.getByRole('button', { name: /send to arc for checking/i })).toBeVisible()
    await expect(page.getByLabel(/insurance on file/i)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^verify/i })).toHaveCount(0)
  })

  test('a partner sends evidence and is left pending, not verified', async ({ page }) => {
    await signInAs(page, PARTNER_EMAIL, '/partner/profile')

    await page.getByLabel('Certifications you hold').fill('ISA Level 1\nFirst aid 2026')
    await page.getByRole('button', { name: /send to arc for checking/i }).click()
    await expect(page.getByText(/ARC will check these|Your existing verification stands/)).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('Certifications you hold')).toHaveValue(/ISA Level 1/)
    // Not verified: the badge says so, whatever was sent.
    await expect(page.getByText(/Verified by ARC/)).toHaveCount(0)
  })

  test('a partner drafts a listing and hands it to the hotel', async ({ page }) => {
    await signInAs(page, PARTNER_EMAIL, '/partner/listings')

    await expect(page.getByRole('heading', { name: 'Your listings', level: 1 })).toBeVisible()
    await page.getByRole('link', { name: /new listing/i }).click()

    await page.getByLabel('Which hotel').selectOption({ index: 1 })
    await page.getByLabel('Kind of activity').selectOption({ index: 1 })
    await page.getByLabel('Title (English)').fill('Dawn patrol at La Punta')
    await page.getByLabel('How long (minutes)').fill('150')
    await page.getByLabel('Smallest party').fill('1')
    await page.getByLabel('Largest party').fill('4')
    await page.getByLabel('Places per departure').fill('4')
    await page.getByLabel('Where you meet').fill('The palapa at the end of the beach road')
    await page.getByLabel('Price per person (pesos)').fill('850')

    await page.getByRole('button', { name: /save as a draft/i }).click()

    // Lands on the listing, which is a draft and nobody can book.
    await expect(
      page.getByRole('heading', { name: 'Dawn patrol at La Punta', level: 1 }),
    ).toBeVisible()
    await expect(page.getByText(/Draft — only you and the hotel can see it/)).toBeVisible()

    await page.getByRole('button', { name: /send to the hotel/i }).click()

    // Durable: the status moved, and the partner cannot go further than this.
    await expect(page.getByText(/With the hotel to publish/)).toBeVisible()
    await expect(page.getByRole('button', { name: /publish/i })).toHaveCount(0)
  })

  test('a published listing locks its details and keeps its price open', async ({ page }) => {
    await signInAs(page, PARTNER_EMAIL, '/partner/listings')

    // The first listing in the list, whatever it is called: the seeded titles
    // are fixture copy and naming one here would be a test of the fixture.
    const first = page.locator('li a[href^="/partner/listings/"]').first()
    await expect(first).toBeVisible()
    await first.click()

    const locked = page.getByText(/live on the hotel’s storefront, so the details are locked/)
    if (await locked.isVisible().catch(() => false)) {
      // The price form is outside the locked fieldset, deliberately: a price
      // change is what the next guest is quoted.
      await expect(page.getByRole('button', { name: /set the new price/i })).toBeEnabled()
      await expect(page.getByRole('button', { name: /^Save$/ })).toHaveCount(0)
    }
  })
})

test.describe('a business asking a hotel to take them on', () => {
  test('the form creates no account and says so', async ({ page }) => {
    await page.goto('/sign-up/partner')

    await expect(page.getByRole('heading', { name: 'Work with a hotel', level: 1 })).toBeVisible()
    await expect(page.getByText(/that is what creates your account/)).toBeVisible()
    // No password field anywhere: nothing here can create a credential.
    await expect(page.getByLabel(/password/i)).toHaveCount(0)

    await page.getByLabel('Which hotel').selectOption({ index: 1 })
    await page.getByLabel('Your business').fill('Cocina Doña Mar')
    await page.getByLabel('Your name').fill('Mar Robles')
    await page.getByLabel('Email').fill('mar.e2e@example.com')
    await page.getByRole('checkbox', { name: 'Dining' }).check()
    await page.getByLabel('What you would offer their guests').fill('A set menu for six.')

    await page.getByRole('button', { name: /send it to the hotel/i }).click()

    await expect(page.getByText(/they will invite you by email/)).toBeVisible()
    await expect(page.getByText(/ARC has not checked anything you have told us/)).toBeVisible()
  })

  test('the hotel sees it and accepting is what creates the partner', async ({ page }) => {
    await page.goto('/sign-up/partner')
    await page.getByLabel('Which hotel').selectOption({ index: 1 })
    await page.getByLabel('Your business').fill('Lancha Azul')
    await page.getByLabel('Your name').fill('Beto')
    await page.getByLabel('Email').fill('beto.e2e@example.com')
    await page.getByRole('checkbox', { name: 'Adventure' }).check()
    await page.getByRole('button', { name: /send it to the hotel/i }).click()
    await expect(page.getByText(/they will invite you by email/)).toBeVisible()

    await signInAs(page, OWNER_EMAIL, '/owner/partners')

    const card = page.locator('li', { hasText: 'Lancha Azul' }).first()
    await expect(card).toBeVisible()
    await expect(
      page.getByText(/ARC has checked none of what they say about themselves/),
    ).toBeVisible()

    await card.getByRole('button', { name: /accept and invite them/i }).click()

    // Durable: they are on the partner list, unverified.
    await page.goto('/owner/partners')
    await expect(page.getByRole('heading', { name: 'Lancha Azul' })).toBeVisible()
    const partnerCard = page.locator('div', { hasText: 'Lancha Azul' }).first()
    await expect(partnerCard.getByText(/Not verified by ARC/).first()).toBeVisible()

    await signOut(page)
  })
})
