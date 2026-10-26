import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import {
  ADMIN_EMAIL,
  GUEST_PORTAL_TOKENS,
  OWNER_EMAIL,
  PARTNER_EMAIL,
  signInAs,
  signOut,
  switchLocale,
} from './helpers'

/**
 * The accessibility audit, as a spec rather than a one-off report.
 *
 * A report is a snapshot of a branch. This runs on every acceptance run, so a
 * regression is a failing test rather than something discovered by the next
 * audit — which is the difference between having audited the product once and
 * the product being accessible.
 *
 * ## What it checks against
 *
 * WCAG 2.1 A and AA, which is what a hotel's procurement questionnaire asks
 * about and what Mexico's and the EU's public-sector rules reference. Axe's
 * `best-practice` rules are deliberately **not** included: they are advice, some
 * of it contested, and a failing test that reports advice gets suppressed and
 * takes the real failures with it.
 *
 * ## What an automated audit cannot tell you
 *
 * Axe finds perhaps a third of what a real audit finds. It cannot tell whether
 * a label makes sense, whether a reading order is sensible, whether an error
 * message explains how to recover, or whether any of this works with a screen
 * reader in Spanish. `docs/accessibility.md` records what still needs a person.
 */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function audit(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()

  if (results.violations.length > 0) {
    // Printed as well as asserted: the assertion message alone does not say
    // which element, and "colour-contrast on 3 nodes" is not actionable.
    console.error(
      `[a11y] ${label}:\n` +
        results.violations
          .map(
            (v) =>
              `  ${v.id} (${v.impact ?? 'unknown'}) — ${v.help}\n` +
              v.nodes.map((n) => `      ${n.target.join(' ')}`).join('\n'),
          )
          .join('\n'),
    )
  }

  expect(
    results.violations.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)} node(s))`),
    `WCAG 2.1 AA violations on ${label}`,
  ).toEqual([])
}

test.describe('accessibility', () => {
  test('the public destination surface', async ({ page }) => {
    await page.goto('/')
    await audit(page, 'destination home')
  })

  test('the experiences catalogue', async ({ page }) => {
    await page.goto('/experiences')
    await audit(page, '/experiences')
  })

  test('sign-in', async ({ page }) => {
    await page.goto('/sign-in')
    await audit(page, '/sign-in')
  })

  test('the guest portal, the surface a guest actually uses', async ({ page }) => {
    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}`)
    await audit(page, 'guest portal')

    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}/explore`)
    await audit(page, 'guest explore')

    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}/basket`)
    await audit(page, 'guest basket')
  })

  test('the guest portal in Spanish', async ({ page }) => {
    // Not a formality: `lang` has to change for a screen reader to switch
    // voice, and a page that announces Spanish copy in an English voice is
    // unusable in a way no English-only audit would notice.
    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}`)
    await switchLocale(page, 'es')
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await audit(page, 'guest portal (es)')
  })

  test('the owner surfaces', async ({ page }) => {
    await signInAs(page, OWNER_EMAIL, '/owner')
    await audit(page, '/owner')

    await page.goto('/owner/arrivals')
    await audit(page, '/owner/arrivals')

    await page.goto('/owner/revenue')
    await audit(page, '/owner/revenue')

    await page.goto('/owner/payouts')
    await audit(page, '/owner/payouts')

    // The mail log: a list with a loading, empty and error state, and a
    // `details` disclosure per message (ADR-040).
    await page.goto('/owner/messages')
    await audit(page, '/owner/messages')

    await signOut(page)
  })

  test('the partner surfaces', async ({ page }) => {
    await signInAs(page, PARTNER_EMAIL, '/partner')
    await audit(page, '/partner')

    await page.goto('/partner/availability')
    await audit(page, '/partner/availability')

    await signOut(page)
  })

  test('the admin surfaces, including the verification form', async ({ page }) => {
    await signInAs(page, ADMIN_EMAIL, '/admin')
    await audit(page, '/admin')

    await page.goto('/admin/health')
    await audit(page, '/admin/health')

    await signOut(page)
  })

  test('the password reset surfaces', async ({ page }) => {
    await page.goto('/forgot-password')
    await audit(page, '/forgot-password')

    // The refused-token state, which is what most visitors to this route see:
    // it has to be legible as well as uninformative.
    await page.goto('/reset-password/a-token-that-was-never-issued')
    await audit(page, '/reset-password/[token] refused')
  })

  test('the guest account surfaces', async ({ page }) => {
    await page.goto('/sign-up/guest')
    await audit(page, '/sign-up/guest')

    // A token whose guest nobody has claimed, so the in-portal form renders
    // rather than redirecting to an account that already exists.
    await page.goto(`/g/${GUEST_PORTAL_TOKENS.arrivingToday}/account`)
    await audit(page, 'in-portal sign-up')

    // `/me` needs an account, so make one: the surface is a list of stays and
    // money, and auditing it empty would audit the empty state only.
    await page.goto(`/g/${GUEST_PORTAL_TOKENS.advancedSurfer}/account`)
    const passphrase = 'an entirely ordinary passphrase'
    await page.getByLabel('Password', { exact: true }).fill(passphrase)
    await page.getByLabel('Confirm password').fill(passphrase)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: /create the account/i }).click()
    await page.waitForURL('/me')
    await audit(page, '/me')

    await signOut(page)
  })

  test('at phone width, where most guests are', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}`)
    await audit(page, 'guest portal at 390px')
  })
})
