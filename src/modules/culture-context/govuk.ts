import { SourceClass, VerificationStatus } from '@/lib/prisma-types'
import type { TravelAdviceDocument } from '@/modules/integrations/types'
import { snapshotHash } from './hash'
import { ruleRecordSchema, type BriefCategory, type RuleRecord, type SourceRef } from './schemas'
import { compact, htmlToText } from './text'

/**
 * GOV.UK FCDO travel advice: parsing.
 *
 * The provider in `modules/integrations` does the I/O and hands back the raw
 * content item. This file turns it into rule records and snapshot content, and
 * it is pure so it can be tested against a fixture with no network.
 *
 * Every record it emits is `ADVISORY` and is attributed to the FCDO under the
 * Open Government Licence. FCDO advice is official, but it is another
 * government's advice to its own citizens, not Mexican law, and nothing here
 * can promote it (see `ruleRecordSchema`).
 */
export const GOVUK_AUTHORITY = 'UK Foreign, Commonwealth & Development Office'
export const GOVUK_LICENCE = 'Open Government Licence v3.0'
export const GOVUK_LICENCE_URL =
  'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/'
export const GOVUK_ATTRIBUTION =
  'Contains public sector information licensed under the Open Government Licence v3.0.'

export const govukSourceKey = (slug: string): string => `govuk:${slug}`

export interface AdviceSection {
  category: BriefCategory
  title: string
  /** Full normalised text. Hashed in full; trimmed only for display. */
  text: string
}

/** What is hashed for change detection: content fields only, no timestamps. */
export interface GovUkSnapshotContent {
  sourceKey: string
  sections: AdviceSection[]
}

export interface ParsedAdvice {
  sourceKey: string
  content: GovUkSnapshotContent
  contentHash: string
  source: SourceRef
  rules: RuleRecord[]
}

const SELECTORS: ReadonlyArray<{
  category: BriefCategory
  needles: readonly string[]
  topics: readonly string[]
}> = [
  { category: 'entry', needles: ['entry requirements'], topics: [] },
  {
    category: 'laws-customs',
    needles: ['local laws', 'laws and customs'],
    topics: [
      'driving',
      'medication',
      'drone',
      'filming',
      'nightlife',
      'hiking',
      'climbing',
      'surfing',
      'camping',
    ],
  },
  { category: 'safety', needles: ['safety and security', 'safety'], topics: ['surfing', 'hiking'] },
]

/**
 * Word-prefix matchers. The original used bare substrings, so "bar" matched
 * "barrier" and "sea" matched "research".
 */
const TOPIC_PATTERNS: Record<string, RegExp> = {
  driving: /\b(driv|licen[cs]e|roads?\b)/i,
  medication: /\b(medicin|medication|prescription|drugs?\b)/i,
  drone: /\b(drones?\b|unmanned aircraft)/i,
  filming: /\b(film|photograph|cameras?\b)/i,
  nightlife: /\b(alcohol|drink|nightclub|bars?\b)/i,
  hiking: /\b(hiking|hikes?\b|trek|mountain)/i,
  climbing: /\b(climb|mountaineer)/i,
  surfing: /\b(surf|rip (currents?|tides?)|beach)/i,
  camping: /\b(camping|campsite|wild camp)/i,
}

function topicTags(text: string, allowed: readonly string[]): string[] {
  return allowed.filter((topic) => TOPIC_PATTERNS[topic]?.test(text))
}

/** Every `{title|heading, body|content}` pair in the content item, in document order. */
export function walkParts(node: unknown): Array<{ title: string; text: string }> {
  const out: Array<{ title: string; text: string }> = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child)
      return
    }
    if (value === null || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    const title = record.title ?? record.heading
    const body = record.body ?? record.content
    if (typeof title === 'string' && typeof body === 'string') {
      out.push({ title: title.trim(), text: htmlToText(body) })
    }
    for (const child of Object.values(record)) visit(child)
  }
  visit(node)
  return out
}

export function selectSections(payload: unknown): AdviceSection[] {
  const parts = walkParts(payload)
  const sections: AdviceSection[] = []
  for (const selector of SELECTORS) {
    const match = parts.find((p) => selector.needles.some((n) => p.title.toLowerCase().includes(n)))
    if (!match || !match.text) continue
    sections.push({ category: selector.category, title: match.title, text: match.text })
  }
  return sections
}

export function govukSnapshotContent(slug: string, sections: AdviceSection[]): GovUkSnapshotContent {
  return { sourceKey: govukSourceKey(slug), sections }
}

/**
 * Parses one content item into advisory records.
 *
 * Returns no rules (not invented ones) when the payload has none of the
 * expected sections; the brief service reports that as unparseable.
 */
export function parseGovUkAdvice(
  document: TravelAdviceDocument,
  jurisdiction: string,
): ParsedAdvice {
  const sections = selectSections(document.payload)
  const content = govukSnapshotContent(document.slug, sections)
  const contentHash = snapshotHash(content)
  const iso = jurisdiction.toUpperCase()

  const source: SourceRef = {
    id: `${content.sourceKey}:${contentHash.slice(0, 12)}`,
    authority: GOVUK_AUTHORITY,
    url: document.sourceUrl,
    jurisdiction: iso,
    sourceClass: SourceClass.GOVERNMENT_ADVISORY,
    retrievedAt: document.retrievedAt,
    contentHash,
    licence: GOVUK_LICENCE,
    licenceUrl: GOVUK_LICENCE_URL,
    attribution: GOVUK_ATTRIBUTION,
    isFixture: document.isFixture,
  }

  const rules = sections.map((section) => {
    const selector = SELECTORS.find((s) => s.category === section.category)
    return ruleRecordSchema.parse({
      id: `${content.sourceKey}:${section.category}:${contentHash.slice(0, 10)}`,
      jurisdiction: iso,
      category: section.category,
      // Fixed. A government advisory is advisory; see docs/culture-context.md.
      kind: 'ADVISORY',
      title: section.title,
      summary: compact(section.text),
      // Topics rank; they never scope. Scoping a whole section by keyword is
      // how the laws section used to disappear.
      activityTags: [],
      topicTags: topicTags(section.text, selector?.topics ?? []),
      verification: VerificationStatus.UNVERIFIED,
      sources: [source],
    })
  })

  return { sourceKey: content.sourceKey, content, contentHash, source, rules }
}

/** Categories whose text differs between two snapshots. Detection, not materiality. */
export function changedSections(
  previous: GovUkSnapshotContent | null,
  current: GovUkSnapshotContent,
): BriefCategory[] {
  const before = new Map((previous?.sections ?? []).map((s) => [s.category, snapshotHash(s)]))
  const after = new Map(current.sections.map((s) => [s.category, snapshotHash(s)]))
  const categories = new Set<BriefCategory>([...before.keys(), ...after.keys()])
  return [...categories].filter((c) => before.get(c) !== after.get(c)).sort()
}
