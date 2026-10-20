import { expect, test } from '@playwright/test'
import { OWNER_EMAIL, signInAs } from './helpers'

/**
 * Acceptance:
 *   * the owner sees actual simulated revenue separately from opportunities;
 *   * the morning briefing uses stored facts and requires approval for actions.
 */
test.describe('morning briefing and approvals', () => {
  test('the briefing shows each figure with the query that produced it', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner/briefing')

    await expect(page.getByRole('heading', { name: 'Casa Olas', level: 1 })).toBeVisible()
    await expect(page.getByText(/built at .* UTC from stored records/)).toBeVisible()

    await expect(page.getByRole('heading', { name: /earned from experiences/i })).toBeVisible()
    // Every earned figure carries its derivation.
    await expect(page.getByText(/Your share of \d+ orders confirmed/).first()).toBeVisible()
    await expect(page.getByText(/stays bought at least one experience/)).toBeVisible()
  })

  test('earned and potential are visually and textually separated', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner/briefing')

    await expect(page.getByRole('heading', { name: /earned from experiences/i })).toBeVisible()
    await expect(
      page.getByText(/This is the number the pilot is judged on/),
    ).toBeVisible()

    await expect(page.getByRole('heading', { name: /unsold departures/i })).toBeVisible()
    await expect(page.getByText(/It is not revenue, it has not been earned/)).toBeVisible()
    await expect(page.getByText(/never added to the figures above/)).toBeVisible()
  })

  test('the briefing names real catalog gaps from the data', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner/briefing')

    await expect(page.getByRole('heading', { name: /gaps in what you can sell/i })).toBeVisible()
    // The seed leaves amenities unproductised and partners unverified on purpose.
    await expect(page.getByText(/amenity with no experience attached/).first()).toBeVisible()
    await expect(page.getByText(/unverified by ARC/).first()).toBeVisible()
  })

  test('an action requires approval and records who decided', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner/approvals')

    await expect(page.getByRole('heading', { name: 'Approvals', level: 1 })).toBeVisible()
    await expect(page.getByText(/Nothing happens until you say so/)).toBeVisible()

    // The seed leaves three proposals pending.
    const firstProposal = page.locator('form:has(button:text("Approve"))').first()
    await expect(firstProposal).toBeVisible()

    // The evidence behind the proposal is inspectable before deciding.
    await page.getByText('What this is based on').first().click()
    await expect(page.getByText(/^On approval: /).first()).toBeVisible()

    await firstProposal.getByRole('textbox').fill('Approved by the acceptance suite.')
    await firstProposal.getByRole('button', { name: /^Approve$/ }).click()

    // The decision is recorded with the deciding user's name against it.
    await expect(page.getByRole('heading', { name: /^Decided$/ })).toBeVisible()
    await expect(page.getByText(/approved by Elena Marín/i)).toBeVisible()
    await expect(page.getByText(/Approved by the acceptance suite/)).toBeVisible()
  })

  test('rejecting a proposal records the decision and changes nothing', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner/approvals')

    const proposal = page.locator('form:has(button:text("Reject"))').first()
    await expect(proposal).toBeVisible()

    await proposal.getByRole('textbox').fill('Not yet — waiting on documents.')
    await proposal.getByRole('button', { name: /^Reject$/ }).click()

    // The durable record is the decision list, not the transient form message:
    // revalidating the route remounts the form and resets its local state.
    await expect(page.getByRole('heading', { name: /^Decided$/ })).toBeVisible()
    await expect(page.getByText(/rejected by Elena Marín/i).first()).toBeVisible()
    await expect(page.getByText(/waiting on documents/).first()).toBeVisible()
  })

  test('revenue reports contribution per stay with its derivation', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner/revenue')

    await expect(page.getByRole('heading', { name: 'Revenue', level: 1 })).toBeVisible()
    await expect(
      page.getByText(/Contribution per stay — the number the pilot is judged on/),
    ).toBeVisible()
    await expect(page.getByText(/including the \d+ that bought nothing/)).toBeVisible()

    // The split is broken out so the arithmetic can be checked.
    const headline = page.locator('div:has(> dt:text("Your share"))').first()
    await expect(headline).toBeVisible()
    await expect(page.getByText('To partners')).toBeVisible()
    await expect(page.getByText('ARC commission')).toBeVisible()

    // The ledger reconciles.
    await expect(page.getByText(/The ledger reconciles with the orders it came from/)).toBeVisible()
  })

  test('admin verification is the only route to a verified badge', async ({ page }) => {
    await signInAs(page, 'admin@arctravel.demo', '/admin')

    await expect(page.getByRole('heading', { name: 'Verification', level: 1 })).toBeVisible()
    await expect(
      page.getByText(/only route to a verified status anywhere in ARC/),
    ).toBeVisible()
    await expect(page.getByText(/Claimed, not confirmed/).first()).toBeVisible()
  })

  test('system health reports correctness checks, not a score', async ({ page }) => {
    await signInAs(page, 'admin@arctravel.demo', '/admin/health')

    await expect(page.getByRole('heading', { name: 'System health', level: 1 })).toBeVisible()
    await expect(page.getByText('No departure is oversold')).toBeVisible()
    await expect(page.getByText('Every confirmed order’s split reconciles')).toBeVisible()

    // The two that would mean the product is lying must both be ok.
    await expect(page.getByText(/No correctness failures/)).toBeVisible()
  })
})
