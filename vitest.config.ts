import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Honours the `@/*` paths in tsconfig.json.
    tsconfigPaths: true,
    alias: {
      // `server-only` throws by design outside an RSC graph; tests need a no-op.
      'server-only': new URL('./tests/stubs/server-only.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    globalSetup: ['tests/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration tests share one Postgres database; run files serially so a
    // truncate in one file cannot pull rows out from under another.
    fileParallelism: false,
  },
})
