import { z } from 'zod'
import { prisma } from '@/lib/db'
import { invalid, notFound } from '@/lib/errors'
import { money } from '@/lib/money'
import { CommissionBasis, ExperienceCategory, Role } from '@/lib/prisma-types'
import { assertOrganizationAccess, assertPropertyAccess, type ActorContext } from '@/modules/tenancy/context'
import { recordAudit } from '@/modules/workflows/audit'
import {
  resolveCommission,
  splitEarnings,
  type CommissionRuleInput,
  type ResolvedCommission,
} from './commission'

/**
 * Commission administration.
 *
 * `resolveCommission` has always been able to answer "who gets what", and
 * `prisma/seed.ts` wrote a representative set of rules — but no route let an
 * owner see or change one. The commercial consequence was that the commission
 * an owner had agreed with a partner could only be altered by an engineer, and
 * the owner had no way to check what a sale would actually split before it
 * happened.
 *
 * Nothing here computes a split of its own: every figure on the page comes from
 * `resolveCommission` and `splitEarnings`, the same functions checkout uses.
 * A second implementation for display would eventually disagree with the
 * ledger, and the ledger is the one that pays people.
 */
export const commissionRuleSchema = z
  .object({
    /** Omitted when creating. */
    id: z.string().uuid().optional(),
    /** Null for an organization-wide rule. */
    propertyId: z.string().uuid().nullish(),
    /** Null unless the rule is for one experience. */
    experienceId: z.string().uuid().nullish(),
    category: z.nativeEnum(ExperienceCategory).nullish(),
    basis: z.nativeEnum(CommissionBasis).default(CommissionBasis.PERCENT_OF_GROSS),
    /** Basis points for PERCENT_OF_GROSS, minor units for FIXED_PER_UNIT. */
    hotelShare: z.coerce.number().int().min(0).max(10_000_000),
    platformShare: z.coerce.number().int().min(0).max(10_000_000),
    priority: z.coerce.number().int().min(0).max(1000).default(0),
    note: z.string().trim().max(240).nullish(),
    isActive: z.coerce.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.basis !== CommissionBasis.PERCENT_OF_GROSS) return
    if (value.hotelShare + value.platformShare > 10_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hotelShare'],
        message: 'The two shares cannot add up to more than 100% of gross.',
      })
    }
  })

export const commissionDefaultsSchema = z.object({
  hotelBps: z.coerce.number().int().min(0).max(10_000),
  platformBps: z.coerce.number().int().min(0).max(10_000),
})

export type CommissionRuleFormInput = z.infer<typeof commissionRuleSchema>

const RULE_SELECT = {
  id: true,
  propertyId: true,
  experienceId: true,
  category: true,
  basis: true,
  hotelShare: true,
  platformShare: true,
  priority: true,
  isActive: true,
  note: true,
  createdAt: true,
} as const

export interface CommissionOverview {
  organizationId: string
  defaults: { hotelBps: number; platformBps: number }
  rules: Array<
    CommissionRuleInput & {
      note: string | null
      /** The experience's title, when the rule names one. */
      experienceTitle: string | null
    }
  >
  /**
   * What a sale of each published experience would split today, from the live
   * resolver. An owner can see the effect of a rule before a guest books on it.
   */
  preview: Array<{
    experienceId: string
    title: string
    category: ExperienceCategory
    unitPriceMinor: number
    currency: string
    resolved: ResolvedCommission
    hotelMinor: number
    platformMinor: number
    supplierMinor: number
  }>
}

export async function getCommissionOverview(
  actor: ActorContext,
  propertyId: string,
): Promise<CommissionOverview> {
  const { organizationId } = await assertPropertyAccess(actor, propertyId, Role.OWNER, Role.ADMIN)

  const [organization, rules, experiences] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { defaultCommissionBps: true, defaultPlatformCommissionBps: true },
    }),
    prisma.commissionRule.findMany({
      where: { organizationId },
      orderBy: [{ isActive: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
      select: { ...RULE_SELECT, experience: { select: { titleEn: true } } },
    }),
    prisma.experience.findMany({
      where: { propertyId, status: 'PUBLISHED' },
      orderBy: { titleEn: 'asc' },
      select: {
        id: true,
        titleEn: true,
        category: true,
        prices: {
          where: { isActive: true, kind: 'BASE' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { amountMinor: true, currency: true },
        },
      },
    }),
  ])

  const defaults = {
    hotelBps: organization.defaultCommissionBps,
    platformBps: organization.defaultPlatformCommissionBps,
  }

  const ruleInputs: CommissionRuleInput[] = rules.map((rule) => ({
    id: rule.id,
    propertyId: rule.propertyId,
    experienceId: rule.experienceId,
    category: rule.category,
    basis: rule.basis,
    hotelShare: rule.hotelShare,
    platformShare: rule.platformShare,
    priority: rule.priority,
    isActive: rule.isActive,
    createdAt: rule.createdAt,
  }))

  const preview = experiences.map((experience) => {
    const price = experience.prices[0]
    const unitPriceMinor = price?.amountMinor ?? 0
    const currency = price?.currency ?? 'MXN'
    const resolved = resolveCommission(
      ruleInputs,
      { propertyId, experienceId: experience.id, category: experience.category },
      defaults,
    )
    const split = splitEarnings(money(unitPriceMinor, currency), resolved)

    return {
      experienceId: experience.id,
      title: experience.titleEn,
      category: experience.category,
      unitPriceMinor,
      currency,
      resolved,
      hotelMinor: split.hotel.amountMinor,
      platformMinor: split.platform.amountMinor,
      supplierMinor: split.supplier.amountMinor,
    }
  })

  return {
    organizationId,
    defaults,
    rules: rules.map((rule, index) => ({
      ...ruleInputs[index]!,
      note: rule.note,
      experienceTitle: rule.experience?.titleEn ?? null,
    })),
    preview,
  }
}

/** Creates a rule, or updates one this organization owns. */
export async function upsertCommissionRule(
  actor: ActorContext,
  propertyId: string,
  raw: unknown,
): Promise<{ id: string }> {
  const { organizationId } = await assertPropertyAccess(actor, propertyId, Role.OWNER, Role.ADMIN)
  const input = commissionRuleSchema.parse(raw)

  // A rule may narrow to a property or an experience, but only within this
  // organization. Never trust the ids that arrived with the form.
  if (input.propertyId && input.propertyId !== propertyId) {
    await assertPropertyAccess(actor, input.propertyId, Role.OWNER, Role.ADMIN)
  }
  if (input.experienceId) {
    const experience = await prisma.experience.findFirst({
      where: { id: input.experienceId, propertyId: input.propertyId ?? propertyId },
      select: { id: true },
    })
    if (!experience) throw notFound('Experience')
  }

  const data = {
    organizationId,
    propertyId: input.propertyId ?? null,
    experienceId: input.experienceId ?? null,
    category: input.category ?? null,
    basis: input.basis,
    hotelShare: input.hotelShare,
    platformShare: input.platformShare,
    priority: input.priority,
    note: input.note ?? null,
    isActive: input.isActive,
  }

  return prisma.$transaction(async (tx) => {
    let id = input.id ?? null

    if (id) {
      const existing = await tx.commissionRule.findFirst({
        where: { id, organizationId },
        select: { id: true },
      })
      if (!existing) throw notFound('Commission rule')
      await tx.commissionRule.update({ where: { id }, data })
    } else {
      const created = await tx.commissionRule.create({ data, select: { id: true } })
      id = created.id
    }

    await recordAudit(
      {
        organizationId,
        actor,
        action: input.id ? 'commission.rule.updated' : 'commission.rule.created',
        entityType: 'CommissionRule',
        entityId: id,
        metadata: {
          basis: input.basis,
          hotelShare: input.hotelShare,
          platformShare: input.platformShare,
          scope: input.experienceId
            ? 'experience'
            : input.category
              ? 'category'
              : input.propertyId
                ? 'property'
                : 'organization',
          priority: input.priority,
          isActive: input.isActive,
        },
      },
      tx,
    )

    return { id: id! }
  })
}

/**
 * Deactivates rather than deletes.
 *
 * A past order's ledger names the rule that produced its split, so deleting one
 * would orphan an explanation an owner may need months later. `isActive: false`
 * removes it from resolution and keeps the record.
 */
export async function setCommissionRuleActive(
  actor: ActorContext,
  ruleId: string,
  isActive: boolean,
): Promise<void> {
  const rule = await prisma.commissionRule.findUnique({
    where: { id: ruleId },
    select: { id: true, organizationId: true },
  })
  if (!rule) throw notFound('Commission rule')

  await assertOrganizationAccess(actor, rule.organizationId, Role.OWNER, Role.ADMIN)

  await prisma.$transaction(async (tx) => {
    await tx.commissionRule.update({ where: { id: rule.id }, data: { isActive } })
    await recordAudit(
      {
        organizationId: rule.organizationId,
        actor,
        action: isActive ? 'commission.rule.reactivated' : 'commission.rule.deactivated',
        entityType: 'CommissionRule',
        entityId: rule.id,
      },
      tx,
    )
  })
}

/** Changes the fallback split used when no rule matches. */
export async function updateCommissionDefaults(
  actor: ActorContext,
  organizationId: string,
  raw: unknown,
): Promise<void> {
  await assertOrganizationAccess(actor, organizationId, Role.OWNER, Role.ADMIN)
  const input = commissionDefaultsSchema.parse(raw)

  if (input.hotelBps + input.platformBps > 10_000) {
    throw invalid('The two shares cannot add up to more than 100% of gross.')
  }

  const before = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { defaultCommissionBps: true, defaultPlatformCommissionBps: true },
  })

  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: organizationId },
      data: {
        defaultCommissionBps: input.hotelBps,
        defaultPlatformCommissionBps: input.platformBps,
      },
    })
    await recordAudit(
      {
        organizationId,
        actor,
        action: 'commission.defaults.updated',
        entityType: 'Organization',
        entityId: organizationId,
        metadata: {
          fromHotelBps: before.defaultCommissionBps,
          fromPlatformBps: before.defaultPlatformCommissionBps,
          toHotelBps: input.hotelBps,
          toPlatformBps: input.platformBps,
        },
      },
      tx,
    )
  })
}
