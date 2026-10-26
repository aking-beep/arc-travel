import { expect, type Page } from '@playwright/test'
import { demoPortalToken } from '../../src/lib/demo-portals'

/**
 * Shared E2E helpers.
 *
 * Sign-in goes through the real demo account switcher rather than injecting a
 * cookie: the point of an acceptance test is that the journey a person takes
 * works, including the first screen.
 */
export const OWNER_EMAIL = 'elena@casaolas.demo'
export const PARTNER_EMAIL = 'mariana@olasverdes.demo'
export const ADMIN_EMAIL = 'admin@arctravel.demo'

/**
 * Guest portal tokens the seed pins so E2E links never move.
 *
 * Derived rather than written, by the same function the seed uses, so the specs
 * keep working while the tokens stop being public. They were the literals
 * `demo-portal-01`/`03`/`05`, and a portal token is a bearer credential — see
 * `src/lib/demo-portals.ts`. These resolve against whatever
 * `ARC_SEED_TOKEN_SECRET` the run has, which for a local run is the documented
 * non-secret fallback.
 */
export const GUEST_PORTAL_TOKENS = {
  /** Harriet Okonjo — intake complete, beginner surfer, in house. */
  completedIntake: demoPortalToken(1),
  /** Mateo Ferrer — advanced surfer, packed pace. */
  advancedSurfer: demoPortalToken(3),
  /** Yuki Tanaka — arriving today, no transport. */
  arrivingToday: demoPortalToken(5),
} as const

export async function signInAs(page: Page, email: string, next = '/'): Promise<void> {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`)

  const form = page.locator(`form:has(input[value="${email}"])`)
  await expect(form).toBeVisible()
  await form.getByRole('button', { name: /sign in/i }).click()

  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'))
}

export async function signOut(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: /sign out/i }).first()
  if (await button.isVisible().catch(() => false)) {
    await button.click()
    await page.waitForURL('/')
  }
}

/** Parses a formatted MXN figure such as "$1,234" into minor units. */
export function parseMoney(text: string): number {
  const digits = text.replace(/[^\d]/g, '')
  return digits.length === 0 ? 0 : Number(digits) * 100
}

export function dateKeyDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Switches the portal language and waits for the change to actually land.
 *
 * The locale action redirects back to the same path, so `waitForURL` would
 * resolve before the Set-Cookie arrives. Waiting on `html[lang]` waits on the
 * effect rather than on the navigation.
 */
export async function switchLocale(page: Page, locale: 'en' | 'es'): Promise<void> {
  await page.getByRole('button', { name: locale, exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', locale)
}
