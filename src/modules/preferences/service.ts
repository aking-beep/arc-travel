import { prisma } from '@/lib/db'
import { notFound } from '@/lib/errors'
import { ConsentType } from '@/lib/prisma-types'
import { recordAudit } from '@/modules/workflows/audit'
import { track } from '@/modules/analytics/track'
import { intakeSchema, type IntakeInput } from './schemas'

/**
 * Guest preference intake and consent.
 *
 * Consent rows are the authority on what ARC may do with a guest's answers.
 * They are written in the same transaction as the preferences, carry the
 * surface they were captured on, and a withdrawal sets `revokedAt` rather than
 * deleting the row — so there is a record that consent once existed and was
 * taken back.
 */
export async function saveIntake(
  guestId: string,
  raw: unknown,
): Promise<{ personalizationAllowed: boolean }> {
  const guest = await prisma.guest.findUnique({
    where: { id: guestId },
    select: { id: true, organizationId: true, propertyId: true },
  })
  if (!guest) throw notFound('Guest')

  const input: IntakeInput = intakeSchema.parse(raw)
  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.guest.update({
      where: { id: guestId },
      data: {
        interests: input.interests,
        surfAbility: input.surfAbility ?? null,
        pace: input.pace ?? null,
        partySize: input.partySize,
        budgetPerDayMinor: input.budgetPerDayMinor ?? null,
        preferredTransport: input.preferredTransport,
        dietaryNotes: input.dietaryNotes ?? null,
        mobilityNotes: input.mobilityNotes ?? null,
        intakeCompletedAt: now,
      },
    })

    const consents: Array<{ type: ConsentType; granted: boolean }> = [
      { type: ConsentType.DATA_PROCESSING, granted: true },
      { type: ConsentType.PERSONALIZATION, granted: input.personalizationConsent },
      { type: ConsentType.MARKETING_EMAIL, granted: input.marketingConsent },
    ]

    for (const consent of consents) {
      await tx.consent.upsert({
        where: { guestId_type: { guestId, type: consent.type } },
        update: {
          granted: consent.granted,
          source: 'guest-portal-intake',
          grantedAt: consent.granted ? now : null,
          revokedAt: consent.granted ? null : now,
        },
        create: {
          guestId,
          type: consent.type,
          granted: consent.granted,
          source: 'guest-portal-intake',
          grantedAt: consent.granted ? now : null,
        },
      })
    }

    await recordAudit(
      {
        organizationId: guest.organizationId,
        actorKind: 'guest',
        action: 'guest.intake.saved',
        entityType: 'Guest',
        entityId: guestId,
        // Field names and consent flags only. The answers themselves are guest
        // data and stay in the Guest row, not in the audit trail.
        metadata: {
          interests: input.interests,
          hasAbility: Boolean(input.surfAbility),
          pace: input.pace,
          partySize: input.partySize,
          statedBudget: input.budgetPerDayMinor !== null && input.budgetPerDayMinor !== undefined,
          personalization: input.personalizationConsent,
          marketing: input.marketingConsent,
        },
      },
      tx,
    )
  })

  await track({
    organizationId: guest.organizationId,
    propertyId: guest.propertyId,
    name: 'guest_intake_completed',
    surface: 'guest',
    subject: guestId,
    properties: {
      interestCount: input.interests.length,
      personalization: input.personalizationConsent,
    },
  })

  return { personalizationAllowed: input.personalizationConsent }
}

export async function getGuestPreferences(guestId: string) {
  const guest = await prisma.guest.findUnique({
    where: { id: guestId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      locale: true,
      partySize: true,
      surfAbility: true,
      pace: true,
      budgetPerDayMinor: true,
      interests: true,
      preferredTransport: true,
      dietaryNotes: true,
      mobilityNotes: true,
      intakeCompletedAt: true,
      currency: true,
      consents: { select: { type: true, granted: true, grantedAt: true, revokedAt: true } },
    },
  })
  if (!guest) throw notFound('Guest')

  const consentFor = (type: ConsentType): boolean =>
    guest.consents.some((c) => c.type === type && c.granted)

  return {
    ...guest,
    personalizationAllowed: consentFor(ConsentType.PERSONALIZATION),
    marketingAllowed: consentFor(ConsentType.MARKETING_EMAIL),
    dataProcessingAllowed: consentFor(ConsentType.DATA_PROCESSING),
  }
}

/** Withdraws a consent without erasing the fact that it was once given. */
export async function revokeConsent(guestId: string, type: ConsentType): Promise<void> {
  const guest = await prisma.guest.findUnique({
    where: { id: guestId },
    select: { organizationId: true },
  })
  if (!guest) throw notFound('Guest')

  await prisma.$transaction(async (tx) => {
    await tx.consent.upsert({
      where: { guestId_type: { guestId, type } },
      update: { granted: false, revokedAt: new Date() },
      create: {
        guestId,
        type,
        granted: false,
        source: 'guest-portal-revocation',
        revokedAt: new Date(),
      },
    })
    await recordAudit(
      {
        organizationId: guest.organizationId,
        actorKind: 'guest',
        action: 'guest.consent.revoked',
        entityType: 'Consent',
        entityId: guestId,
        metadata: { type },
      },
      tx,
    )
  })
}
