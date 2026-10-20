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
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
