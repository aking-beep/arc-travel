import {
  BRIEF_CATEGORIES,
  type BriefItem,
  type RuleRecord,
  type TravelerProfile,
} from './schemas'

/**
 * Deterministic applicability.
 *
 * A pure function of a rule and a traveller, with every match returned as a
 * reason string, so "why am I seeing this?" always has an answer that came
 * from data rather than from a model.
 *
 * Exclusion and ranking are separate on purpose:
 *
 *   - **Exclusion** happens only on a hard mismatch: the wrong jurisdiction, or
 *     a scoping tag (`activityTags`, `purposeTags`, `nationalityTags`) that the
 *     traveller definitely does not satisfy.
 *   - **Ranking** is what `topicTags` do. A topic the traveller shares raises
 *     the record. A topic they do not share changes nothing.
 *
 * The original excluded on topics. GOV.UK keyword-tags its whole "Local laws
 * and customs" section with words like `driving` and `nightlife`, so a guest
 * who declared none of them lost the entire laws section from their brief.
 * That is the most important section to keep.
 */
export interface Relevance {
  reasons: string[]
  /** Higher sorts first within a category. */
  score: number
  /** True when a scoping tag depends on something we do not know. */
  uncertain: boolean
}

/** Weight of a scoping match relative to a topic match. */
const SCOPE_WEIGHT = 2
const TOPIC_WEIGHT = 1

export function relevance(rule: RuleRecord, traveler: TravelerProfile): Relevance | null {
  const jurisdiction = rule.jurisdiction.toUpperCase()
  if (jurisdiction !== 'GLOBAL' && jurisdiction !== traveler.destinationCountry.toUpperCase()) {
    return null
  }

  const reasons: string[] = []
  let score = 0
  let uncertain = false
  const activities = new Set(traveler.activities.map((a) => a.toLowerCase()))

  if (rule.activityTags.length > 0) {
    const hits = rule.activityTags.map((t) => t.toLowerCase()).filter((t) => activities.has(t))
    if (hits.length === 0) return null
    for (const hit of [...new Set(hits)].sort()) reasons.push(`activity:${hit}`)
    score += SCOPE_WEIGHT * hits.length
  }

  if (rule.purposeTags.length > 0) {
    if (!rule.purposeTags.includes(traveler.purpose)) return null
    reasons.push(`purpose:${traveler.purpose}`)
    score += SCOPE_WEIGHT
  }

  if (rule.nationalityTags.length > 0) {
    if (traveler.nationality === null) {
      // Unknown is not a mismatch. Show it, and say we could not tell.
      reasons.push('nationality:unknown')
      uncertain = true
    } else {
      const nationality = traveler.nationality.toUpperCase()
      if (!rule.nationalityTags.some((n) => n.toUpperCase() === nationality)) return null
      reasons.push(`nationality:${nationality}`)
      score += SCOPE_WEIGHT
    }
  }

  const topicHits = [...new Set(rule.topicTags.map((t) => t.toLowerCase()))]
    .filter((t) => activities.has(t))
    .sort()
  for (const hit of topicHits) reasons.push(`topic:${hit}`)
  score += TOPIC_WEIGHT * topicHits.length

  if (reasons.length === 0) reasons.push('destination')
  return { reasons, score, uncertain }
}

export function toBriefItem(rule: RuleRecord, traveler: TravelerProfile): BriefItem | null {
  const match = relevance(rule, traveler)
  if (!match) return null
  return {
    id: rule.id,
    category: rule.category,
    kind: rule.kind,
    title: rule.title,
    summary: rule.summary,
    relevance: match.reasons,
    rank: match.score,
    applicabilityUncertain: match.uncertain,
    verification: rule.verification,
    sources: rule.sources,
  }
}

/** Category order, then rank, then title. Stable and clock-free. */
export function rankBriefItems(items: BriefItem[]): BriefItem[] {
  const order = (category: string) => {
    const index = (BRIEF_CATEGORIES as readonly string[]).indexOf(category)
    return index === -1 ? BRIEF_CATEGORIES.length : index
  }
  return [...items].sort(
    (a, b) =>
      order(a.category) - order(b.category) ||
      b.rank - a.rank ||
      a.title.toLowerCase().localeCompare(b.title.toLowerCase()) ||
      a.id.localeCompare(b.id),
  )
}
