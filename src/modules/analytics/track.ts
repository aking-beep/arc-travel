import { prisma, type Prisma } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { pseudonymize, redact } from '@/lib/redact'

/**
 * First-party product analytics.
 *
 * Events are written to our own table rather than shipped to a third party in
 * the POC: the pilot's first metric (incremental destination-commerce
 * contribution per stay) has to be computed from the same rows that produced the
 * orders, or the two numbers will disagree and nobody will trust either.
 *
 * `subjectKey` is always a pseudonym — HMAC-SHA256 under a dedicated salt. An
 * email or phone number must never reach this table; see src/lib/redact.ts.
 */
export type AnalyticsSurface = 'owner' | 'guest' | 'partner' | 'admin' | 'system'

export interface TrackInput {
  organizationId: string
  propertyId?: string | null
  name: string
  surface: AnalyticsSurface
  /** Raw identifier (stay id, guest id, user id). Hashed before storage. */
  subject?: string | null
  properties?: Record<string, unknown>
  occurredAt?: Date
}

type Client = Prisma.TransactionClient | typeof prisma

export async function track(input: TrackInput, client: Client = prisma): Promise<void> {
  // A dedicated salt, not the session-signing secret.
  const salt = getEnv().ANALYTICS_SALT

  await client.analyticsEvent.create({
    data: {
      organizationId: input.organizationId,
      propertyId: input.propertyId ?? null,
      name: input.name,
      surface: input.surface,
      subjectKey: input.subject ? pseudonymize(input.subject, salt) : null,
      propertiesJson: input.properties
        ? (redact(input.properties) as Prisma.InputJsonValue)
        : undefined,
      occurredAt: input.occurredAt ?? new Date(),
    },
  })
}

/**
 * Fire-and-forget variant for request paths where analytics must never be the
 * reason a guest sees an error.
 */
export function trackSafely(input: TrackInput, client: Client = prisma): void {
  void track(input, client).catch((error: unknown) => {
    console.warn('[analytics] failed to record %s:', input.name, error)
  })
}
