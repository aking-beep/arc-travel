import { execFileSync } from 'node:child_process'
import 'dotenv/config'

/**
 * Reseeds the demo database before the E2E run.
 *
 * The acceptance tests exercise the real demo data an owner would be shown, so
 * they need a known starting state: the suite buys things, publishes
 * experiences and approves actions, all of which change it.
 */
export default function globalSetup(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.')
  }

  execFileSync('npx', ['tsx', 'prisma/seed.ts'], {
    stdio: 'inherit',
    env: process.env,
  })
}
