import { applyBps, money, splitByBps, type Money } from '@/lib/money'
import { CommissionBasis, type ExperienceCategory } from '@/lib/prisma-types'

/**
 * Commission resolution and the earnings split.
 *
 * Three parties take a share of every gross line: the hotel (for owning the
 * guest relationship and the storefront), ARC (platform fee), and the supplier
 * (who gets the remainder and actually delivers the experience).
 *
 * Resolution is "most specific rule wins" so an owner can override one
 * experience without touching anything else:
 *
 *   experience-specific > category-specific > property-wide > organization default
 *
 * Ties break on `priority` (higher first), then on the newest rule. The result
 * is deterministic for a given rule set, which is what makes the ledger
 * reproducible.
 */
export interface CommissionRuleInput {
  id: string
  propertyId: string | null
  experienceId: string | null
  category: ExperienceCategory | null
  basis: CommissionBasis
  hotelShare: number
  platformShare: number
  priority: number
  isActive: boolean
  createdAt: Date
}

export interface CommissionTarget {
  propertyId: string
  experienceId: string
  category: ExperienceCategory
}

export interface ResolvedCommission {
  ruleId: string | null
  basis: CommissionBasis
  hotelShare: number
  platformShare: number
  /** Why this rule won, for the owner-facing explanation. */
  specificity: 'experience' | 'category' | 'property' | 'organization-default'
}

const SPECIFICITY_RANK = {
  experience: 3,
  category: 2,
  property: 1,
  'organization-default': 0,
} as const

function specificityOf(rule: CommissionRuleInput): ResolvedCommission['specificity'] | null {
  if (rule.experienceId) return 'experience'
  if (rule.category) return 'category'
  if (rule.propertyId) return 'property'
  return 'organization-default'
}

/**
 * The organization's fallback split, used when no rule matches.
 *
 * `platformBps` used to be hard-coded to zero here, which meant a tenant with
 * no commission rule generated ledger lines where ARC earned nothing — the
 * platform's own revenue depended on somebody remembering to write a rule.
 * Both halves of the default now come from the organization row, so the
 * fallback is a stated commercial position rather than an omission.
 */
export interface CommissionDefaults {
  hotelBps: number
  platformBps: number
}

export function resolveCommission(
  rules: CommissionRuleInput[],
  target: CommissionTarget,
  defaults: CommissionDefaults,
): ResolvedCommission {
  const applicable = rules
    .filter((r) => r.isActive)
    .filter((r) => !r.propertyId || r.propertyId === target.propertyId)
    .filter((r) => !r.experienceId || r.experienceId === target.experienceId)
    .filter((r) => !r.category || r.category === target.category)

  const ranked = applicable
    .map((rule) => ({ rule, specificity: specificityOf(rule) }))
    .filter((x): x is { rule: CommissionRuleInput; specificity: ResolvedCommission['specificity'] } =>
      x.specificity !== null,
    )
    .sort((a, b) => {
      const bySpecificity = SPECIFICITY_RANK[b.specificity] - SPECIFICITY_RANK[a.specificity]
      if (bySpecificity !== 0) return bySpecificity
      if (b.rule.priority !== a.rule.priority) return b.rule.priority - a.rule.priority
      return b.rule.createdAt.getTime() - a.rule.createdAt.getTime()
    })

  const winner = ranked[0]
  if (!winner) {
    return {
      ruleId: null,
      basis: CommissionBasis.PERCENT_OF_GROSS,
      hotelShare: defaults.hotelBps,
      platformShare: defaults.platformBps,
      specificity: 'organization-default',
    }
  }

  return {
    ruleId: winner.rule.id,
    basis: winner.rule.basis,
    hotelShare: winner.rule.hotelShare,
    platformShare: winner.rule.platformShare,
    specificity: winner.specificity,
  }
}

export interface EarningsSplit {
  gross: Money
  hotel: Money
  platform: Money
  supplier: Money
}

/**
 * Splits a gross line total three ways.
 *
 * The supplier takes the remainder, including every rounding remainder, so the
 * three parts always re-sum to gross exactly. A ledger that does not balance is
 * a bug, and we would rather give the centavo to the operator who did the work
 * than leave it unaccounted.
 */
export function splitEarnings(gross: Money, commission: ResolvedCommission, quantity = 1): EarningsSplit {
  if (commission.basis === CommissionBasis.FIXED_PER_UNIT) {
    const hotel = money(commission.hotelShare * quantity, gross.currency)
    const platform = money(commission.platformShare * quantity, gross.currency)
    const supplierAmount = gross.amountMinor - hotel.amountMinor - platform.amountMinor
    if (supplierAmount < 0) {
      throw new Error(
        `Fixed commission (${hotel.amountMinor + platform.amountMinor}) exceeds gross (${gross.amountMinor}).`,
      )
    }
    return { gross, hotel, platform, supplier: money(supplierAmount, gross.currency) }
  }

  const totalBps = commission.hotelShare + commission.platformShare
  if (totalBps > 10_000) {
    throw new Error(`Commission shares sum to ${totalBps} bps, which exceeds gross.`)
  }

  const parts = splitByBps(
    gross,
    [
      { key: 'hotel', bps: commission.hotelShare },
      { key: 'platform', bps: commission.platformShare },
      { key: 'supplier', bps: 10_000 - totalBps },
    ],
    'supplier',
  )

  return {
    gross,
    hotel: parts.hotel ?? money(0, gross.currency),
    platform: parts.platform ?? money(0, gross.currency),
    supplier: parts.supplier ?? money(0, gross.currency),
  }
}

/** Commission on a hypothetical sale, for the owner's opportunity figures. */
export function potentialHotelEarnings(
  gross: Money,
  commission: ResolvedCommission,
  quantity = 1,
): Money {
  if (commission.basis === CommissionBasis.FIXED_PER_UNIT) {
    return money(commission.hotelShare * quantity, gross.currency)
  }
  return applyBps(gross, commission.hotelShare)
}
