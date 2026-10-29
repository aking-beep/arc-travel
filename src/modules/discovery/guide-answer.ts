import 'server-only'

import { z } from 'zod'
import { getCulture, type CultureGuide } from './content/culture'
import { getDestination } from './content/destinations'
import { prisma } from '@/lib/db'
import { EntityStatus } from '@/lib/prisma-types'
import { runAI } from '@/modules/ai/service'

/**
 * The local guide, answered by a model that may only read what the editors
 * wrote.
 *
 * The panel this replaces counted keyword overlaps against a hand-written FAQ
 * and returned the best-scoring entry, which meant it answered three
 * questions well and everything else with "I don't have a prepared answer for
 * that". Its framing was deliberately defensive, for a good reason recorded in
 * the component: the Magic Patterns export opened with "ask me anything about
 * visiting — tipping, dress, water, safety" and answered from a word count,
 * which on a safety question is worse than useless.
 *
 * A model changes what is possible without changing what is permitted. The
 * rules here are the product's, not the model's to negotiate:
 *
 *   * **It reads only this destination's guide.** The notes are the entire
 *     world it is given. It is told, repeatedly, not to supply anything from
 *     its own knowledge — so "what is the bus fare" gets a refusal rather than
 *     a plausible number, which is the failure mode that matters for a real
 *     place somebody is about to travel to.
 *   * **It refuses whole subjects outright.** Safety, the state of the sea or
 *     the mountain, law, visas, borders and medical advice are returned as a
 *     refusal with a pointer, whatever the notes happen to contain.
 *     Non-negotiable 1 says never claim something is safe; non-negotiable 8
 *     says an advisory is never rendered as law. A model asked "is Zicatela
 *     safe today" must not answer from a paragraph written last week.
 *   * **It decides nothing.** No tools, no write path, no recommendation that
 *     the editorial content did not already make. Non-negotiable 5, unchanged:
 *     this rephrases and draws together prose a person wrote.
 *
 * Every call goes through `runAI`, so it is rate limited, screened for
 * injection, recorded as an `AgentRun` with its cost, and — this is the part
 * the caller depends on — never throws. A failed or unconfigured model returns
 * `null` and the panel falls back to the keyword matcher it always had.
 */

/** Subjects the model may not answer from editorial prose, whatever it says. */
const REFUSED_SUBJECTS =
  /\b(safe|safety|dangerous|danger|risk|drown|rip ?current|shark|avalanche|crevasse|surf (?:report|conditions)|swell|tide|visa|passport|border|customs|legal|law|arrest|police report|insurance claim|vaccin|malaria|dengue|medic|doctor|prescription|allerg|emergency)\b/i

export type GuideAnswer = {
  /** The answer, or the refusal. Always something a person can read. */
  text: string
  /** Where it came from, so the panel can label it honestly. */
  source: 'ai' | 'refused'
  /** The FAQ questions the model drew on, for the panel to show underneath. */
  drawnFrom: string[]
}

const answerSchema = z.object({
  /**
   * False when the notes do not support an answer. The model is told to prefer
   * this over producing something plausible, and the prompt says so twice.
   */
  answered: z.boolean(),
  text: z.string().min(1).max(1200),
  drawnFrom: z.array(z.string()).max(6).default([]),
})

/** Everything the model is allowed to know, and nothing else. */
function notesFor(guide: CultureGuide, name: string): Record<string, unknown> {
  return {
    destination: name,
    writtenBy: 'ARC editors',
    lastReadThrough: guide.reviewedAt,
    intro: guide.intro,
    etiquette: guide.etiquette,
    traditions: guide.traditions,
    language: guide.language,
    customs: guide.customs,
    responsibleTourism: guide.responsible,
    seasons: guide.seasons,
    community: guide.community,
    preparedAnswers: guide.faq,
    /*
     * Included so the model can say "the notes do not cover this" accurately,
     * and deliberately NOT as material to answer from: an advisory is
     * editorial guidance, and repeating one in the model's own words is how it
     * stops reading as one (ADR-024).
     */
    advisoriesAreEditorialAndMustNotBeRestated: guide.advisories.length,
  }
}

const SYSTEM = [
  'You answer a traveller’s question about one destination, using ONLY the editorial notes supplied under "facts".',
  'Those notes are the entire world you know about this place. You have no other knowledge of it and must behave as though you do not.',
  'If the notes do not answer the question, set answered=false and say plainly that the guide does not cover it. Never fill a gap with something plausible — a wrong bus fare, opening time, price or phone number for a real place is worse than no answer.',
  'Never state or imply that a place, a beach, a wave, a mountain or an activity is safe, and never describe current conditions. Those change by the hour and you are reading prose that may be months old.',
  'Never give legal, immigration, visa, border or medical advice, and never restate a travel advisory as though it were a rule. Set answered=false for these and say who to ask instead.',
  'Do not invent an experience, a price, an availability, a business name or a certification.',
  'Write two or three sentences in plain British English, in the same measured voice as the notes. No greeting, no sign-off, no lists.',
  'Put into drawnFrom the exact text of any prepared-answer questions you leaned on, and leave it empty if none.',
].join(' ')

/**
 * Answer a question about a destination from its guide.
 *
 * Returns `null` when the model is unavailable, unconfigured, rate limited or
 * failed — the caller falls back to the deterministic matcher rather than
 * showing an error. A refusal is not a failure and comes back as a
 * `GuideAnswer` with `source: 'refused'`.
 */
export async function answerFromGuide(
  destinationSlug: string,
  question: string,
): Promise<GuideAnswer | null> {
  const guide = getCulture(destinationSlug)
  const destination = getDestination(destinationSlug)
  if (!guide || !destination) return null

  const asked = question.trim()
  if (asked.length < 2 || asked.length > 400) return null

  /*
   * Refused before anything is spent.
   *
   * A crude pattern, and crude in the right direction: it over-refuses rather
   * than letting a safety question reach a model holding month-old prose. The
   * refusal names where the live answer actually lives — the dated readings
   * on the local guide, or a person standing on the beach.
   */
  if (REFUSED_SUBJECTS.test(asked)) {
    return {
      text: `The guide to ${destination.name} is editorial writing, last read through on ${guide.reviewedAt}, so it is the wrong thing to answer that from. Anything about conditions, safety, law, borders or health needs a current source: the dated readings on this page for the state of the water, your government's own advice for travel and entry, and a guide, a lifeguard or a doctor on the ground for the rest.`,
      source: 'refused',
      drawnFrom: [],
    }
  }

  /*
   * `runAI` is tenant-scoped, and this is a public page. The one published
   * property is the tenant whose editorial surface this is; with no property
   * published there is nothing to bill the call to, so the panel stays
   * deterministic.
   */
  const tenant = await prisma.property.findFirst({
    where: { status: EntityStatus.ACTIVE },
    orderBy: { createdAt: 'asc' },
    select: { organizationId: true },
  })
  if (!tenant) return null

  const result = await runAI({
    organizationId: tenant.organizationId,
    task: 'culture_guide_answer',
    system: SYSTEM,
    facts: notesFor(guide, destination.name),
    // The visitor's question, screened for injection and enveloped by `runAI`.
    untrusted: { question: asked },
    schema: answerSchema,
    // Public and unauthenticated, so the bucket is the destination rather than
    // a user. One shared ceiling per guide page is the point: this is an
    // unbounded path to a paid API.
    rateLimitKey: `guide:${destinationSlug}`,
  })

  if (!result.data) return null
  if (!result.data.answered) {
    return { text: result.data.text, source: 'refused', drawnFrom: [] }
  }

  return {
    text: result.data.text,
    source: 'ai',
    drawnFrom: result.data.drawnFrom,
  }
}
