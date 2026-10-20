import { expect, test } from '@playwright/test'
import { GUEST_PORTAL_TOKENS, switchLocale } from './helpers'

/**
 * Acceptance: the Spanish and English guest experience works on mobile.
 *
 * Runs under the `mobile` project (Pixel 7) as well as desktop, because the
 * guest portal's real deployment target is a phone held one-handed at a front
 * desk. The filename matches the config's `mobile.*.spec.ts` pattern.
 */
test.describe('guest portal on mobile, in both languages', () => {
  test('the portal is usable at phone width with the tab bar reachable', async ({ page }) => {
    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}`)

    await expect(page.getByRole('heading', { name: 'Casa Olas', level: 1 })).toBeVisible()

    // The bottom tab bar is the primary navigation and must be on screen.
    const nav = page.getByRole('navigation', { name: /guest sections/i })
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('link', { name: /explore|explorar/i })).toBeVisible()

    // Nothing may overflow horizontally: a guest should never scroll sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(overflow, 'no horizontal page scroll').toBe(false)
  })

  test('switching to Spanish translates the portal and persists', async ({ page }) => {
    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}`)

    await switchLocale(page, 'es')

    // The document language changes, and so does the navigation.
    const nav = page.getByRole('navigation', { name: /guest sections/i })
    await expect(nav.getByRole('link', { name: 'Explorar' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Canasta' })).toBeVisible()

    // The demo notice is translated too, not left in English.
    await expect(page.getByText(/Entorno de demostración/)).toBeVisible()

    // The choice survives navigation.
    await page.getByRole('link', { name: 'Explorar' }).click()
    await expect(page.getByRole('heading', { name: 'Explorar' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  })

  test('Spanish conditions carry the same timestamp and disclaimer', async ({ page }) => {
    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}`)
    await switchLocale(page, 'es')

    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}/guide`)

    await expect(page.getByRole('heading', { name: /Condiciones del mar/ })).toBeVisible()
    await expect(page.getByText(/Lectura tomada/).first()).toBeVisible()
    // The safety disclaimer must exist in Spanish, not only English.
    await expect(
      page.getByText(/no puede decirte que una playa es segura/).first(),
    ).toBeVisible()
  })

  test('the Spanish intake form is fully translated', async ({ page }) => {
    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}`)
    await switchLocale(page, 'es')

    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}/intake`)

    await expect(page.getByRole('heading', { name: /Unas preguntas/ })).toBeVisible()
    await expect(page.getByText(/¿A qué vienes\?/)).toBeVisible()
    await expect(page.getByLabel(/Experiencia en surf/)).toBeVisible()
    await expect(page.getByText(/Acepto que ARC Stay procese/)).toBeVisible()
  })

  test('switching back to English restores it', async ({ page }) => {
    await page.goto(`/g/${GUEST_PORTAL_TOKENS.completedIntake}`)
    await switchLocale(page, 'es')
    await switchLocale(page, 'en')
  })

  test('the app declares itself installable as a PWA', async ({ page }) => {
    const response = await page.goto('/manifest.webmanifest')
    expect(response?.ok()).toBeTruthy()

    const manifest = (await response?.json()) as {
      name: string
      display: string
      icons: Array<{ src: string }>
    }
    expect(manifest.display).toBe('standalone')
    expect(manifest.name).toContain('ARC Stay')
    expect(manifest.icons.length).toBeGreaterThan(0)
  })
})
