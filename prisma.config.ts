import 'dotenv/config'
import path from 'node:path'
import { defineConfig } from 'prisma/config'
import { applyDatabaseUrl } from './src/lib/database-url'

// The CLI resolves `env("DATABASE_URL")` out of `process.env`, so a hosting
// provider's prefixed connection string has to be written back before any
// command runs. See `src/lib/database-url.ts`.
applyDatabaseUrl()

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
})
