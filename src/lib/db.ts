import { PrismaClient } from '@prisma/client'

import { applyDatabaseUrl } from './database-url'

applyDatabaseUrl()

/**
 * One PrismaClient per process. Next.js hot-reloads modules in development, so
 * the instance is parked on `globalThis` to avoid exhausting the pool.
 */
const globalForPrisma = globalThis as unknown as { arcPrisma?: PrismaClient }

export const prisma: PrismaClient =
  globalForPrisma.arcPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.arcPrisma = prisma
}

export type { Prisma } from '@prisma/client'
