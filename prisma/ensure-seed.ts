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
import { PrismaClient } from '@prisma/client'

async function countOrganizations(): Promise<number> {
  const prisma = new PrismaClient()
  try {
    return await prisma.organization.count()
  } finally {
    await prisma.$disconnect()
  }
}

async function main(): Promise<void> {
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
