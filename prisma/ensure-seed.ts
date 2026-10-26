/**
 * Seed the demo data, but only into an empty database.
 *
 * `npm run db:seed` truncates the tenant tables first. That is right on a
 * developer machine and wrong for a hosted demo: every redeploy would wipe
 * whatever the person showing the demo had just built up. This runs in the
 * hosted build, so the first deploy gets the full Casa Olas fixture and later
 * deploys leave the data alone.
 *
 * The seed runs as a child process rather than an import: `prisma/seed.ts`
 * invokes `main()` as a module side effect and reports failure through
 * `process.exitCode`, which an importing process cannot observe.
 */
import 'dotenv/config'
import { applyDatabaseUrl } from '../src/lib/database-url'

applyDatabaseUrl()
import { execFileSync } from 'node:child_process'
import { prisma } from '../src/lib/db'

async function countOrganizations(): Promise<number> {
  try {
    return await prisma.organization.count()
  } finally {
    await prisma.$disconnect()
  }
}

async function main(): Promise<void> {
  // The seed itself refuses to run outside demo mode, but saying so here keeps
  // the hosted build's log honest rather than making it look like a failure.
  const mode = process.env.ARC_DATA_MODE ?? 'demo'
  if (mode !== 'demo' && process.env.ARC_ALLOW_SEED !== '1') {
    console.log('[ensure-seed] ARC_DATA_MODE=%s — not seeding synthetic data.', mode)
    return
  }

  const existing = await countOrganizations()
  if (existing > 0) {
    console.log(
      '[ensure-seed] %d organization(s) already present — leaving the data alone.',
      existing,
    )
    return
  }

  console.log('[ensure-seed] empty database — running the demo seed.')
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'prisma/seed.ts'], {
    stdio: 'inherit',
  })
}

main().catch((error) => {
  console.error('[ensure-seed] failed:', error)
  process.exit(1)
})
