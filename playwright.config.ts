import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

/**
 * Some sandboxes ship a pre-installed Chromium at a different build revision
 * than the one this Playwright version downloads. When such a binary is
 * present, use it rather than failing with "Executable doesn't exist"; in CI,
 * where `playwright install` runs normally, this resolves to undefined and
 * Playwright uses its own download.
 */
const PREINSTALLED_CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)

const PORT = Number(process.env.E2E_PORT ?? 3100)
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

/**
 * A fresh secret for this run's seeded portal tokens.
 *
 * `next start` is a production build, so the env contract's production checks
 * apply — including the one that refuses the documented local fallback for
 * `ARC_SEED_TOKEN_SECRET`, on the grounds that a value anyone can read cannot
 * key a bearer credential. A fixed secret written into this file would have
 * exactly the property that check exists to reject, so this is random per run
 * instead: stable across the three processes that need to agree (this one, the
 * global setup that reseeds, and the server), different every time, and not
 * computable from anything in the repository.
 *
 * Set into `process.env` because `tests/e2e/helpers.ts` derives the tokens the
 * specs navigate to from the same function the seed uses.
 */
process.env.ARC_SEED_TOKEN_SECRET ??= randomBytes(32).toString('hex')

export default defineConfig({
  testDir: './tests/e2e',
  // Reseeds the demo database so the acceptance run starts from a known state.
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    locale: 'en-US',
    ...(PREINSTALLED_CHROMIUM ? { launchOptions: { executablePath: PREINSTALLED_CHROMIUM } } : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\..*\.spec\.ts/ },
  ],
  webServer: {
    command: `npm run start -- --port ${PORT}`,
    url: BASE_URL,
    /*
     * Never reuse a server somebody left running, even locally.
     *
     * `next start` serves the `.next` build it found at boot, and the HTML it
     * renders names hashed asset chunks. Rebuild while it is running and every
     * page it then serves asks for stylesheets that no longer exist: the CSS
     * request aborts, Tailwind's `relative` never applies, and a `fill` image
     * positions itself against the viewport instead of its card — so the suite
     * fails with clicks intercepted by an image from another section, which
     * reads as a product bug and is not one. It cost an hour once.
     *
     * With this false, a busy port is an immediate, legible error instead.
     */
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    /*
     * The front door is open here, declared rather than worked around.
     *
     * The specs sign in through the real credential-free account switcher,
     * which is precisely what that check is about, so this runner *is* an open
     * demo and saying so is the honest answer. Keying the check on something
     * other than NODE_ENV would mean it never ran anywhere it could be tested.
     */
    env: {
      ARC_ALLOW_OPEN_DEMO: '1',
      ARC_SEED_TOKEN_SECRET: process.env.ARC_SEED_TOKEN_SECRET as string,
    },
  },
})
