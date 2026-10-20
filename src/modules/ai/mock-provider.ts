import { createHash } from 'node:crypto'
import type { AICallOptions, AIProvider, AIResult } from './provider'

/**
 * Deterministic mock provider.
 *
 * The default in every environment, and the reason the POC needs no API key,
 * no network and no budget. It is not a stub that returns lorem ipsum: it
 * composes real sentences from the facts it is handed, so the explanations in
 * the demo are the same explanations the deterministic engine produced, only
 * joined up.
 *
 * Because it is a pure function of its input, the same itinerary always gets
 * the same prose — which makes it usable in Playwright assertions.
 */
export class MockAIProvider implements AIProvider {
  readonly name = 'mock'
  readonly model = 'mock-deterministic-v1'

  async complete<T>(options: AICallOptions<T>): Promise<AIResult<T>> {
    const started = Date.now()
    const composed = this.compose(options)
    const parsed = options.schema.safeParse(composed)

    const inputTokens = estimateTokens(JSON.stringify(options.input) + options.system)
    const outputTokens = estimateTokens(JSON.stringify(composed))

    return {
      ok: parsed.success,
      data: parsed.success ? parsed.data : null,
      provider: this.name,
      model: this.model,
      inputTokens,
      outputTokens,
      // The mock costs nothing. Recorded anyway so the telemetry path is
      // exercised in development rather than first tried in production.
      costMicroUsd: 0,
      latencyMs: Math.max(1, Date.now() - started),
      validationError: parsed.success ? null : parsed.error.message,
      blockedReason: null,
    }
  }

  private compose<T>(options: AICallOptions<T>): unknown {
    switch (options.task) {
      case 'itinerary.rationale':
        return this.itineraryRationale(options.input)
      case 'guide.answer':
        return this.guideAnswer(options.input)
      case 'briefing.compose':
        return this.briefingNarrative(options.input)
      case 'experience.blurb':
        return this.experienceBlurb(options.input)
      default:
        return { paragraphs: [] }
    }
  }

  private itineraryRationale(input: Record<string, unknown>): unknown {
    const days = Array.isArray(input.days) ? input.days : []
    const pace = typeof input.pace === 'string' ? input.pace.toLowerCase() : 'balanced'

    const paragraphs: string[] = []
    const scheduled = days.reduce<number>(
      (n, day) => n + Number((day as { scheduledCount?: unknown }).scheduledCount ?? 0),
      0,
    )

    paragraphs.push(
      scheduled === 0
        ? 'We could not fit anything bookable into these dates. What follows is the reasoning, and the gaps are ours to close.'
        : `This plan holds ${scheduled} booked ${scheduled === 1 ? 'thing' : 'things'} across ${days.length} ${days.length === 1 ? 'day' : 'days'}, spaced for a ${pace} pace.`,
    )

    const reasons = Array.isArray(input.topReasons) ? input.topReasons.slice(0, 3) : []
    if (reasons.length > 0) {
      paragraphs.push(`The strongest matches came down to: ${reasons.map(String).join('; ')}.`)
    }

    const unmet = Array.isArray(input.unmetConstraints) ? input.unmetConstraints : []
    if (unmet.length > 0) {
      paragraphs.push(
        `There are ${unmet.length} ${unmet.length === 1 ? 'thing' : 'things'} we could not accommodate, listed below rather than hidden.`,
      )
    }

    paragraphs.push(
      'Ocean conditions are shown with the time each reading was taken. They change through the day, so treat them as information and ask your guide before you get in the water.',
    )

    return { paragraphs }
  }

  private guideAnswer(input: Record<string, unknown>): unknown {
    const places = Array.isArray(input.places) ? input.places : []
    const question = typeof input.question === 'string' ? input.question : ''

    const named = places
      .map((p) => (p as { name?: unknown }).name)
      .filter((n): n is string => typeof n === 'string')
      .slice(0, 3)

    const paragraphs: string[] = []
    if (named.length > 0) {
      paragraphs.push(
        `From what the hotel has recorded, the places most relevant here are ${named.join(', ')}.`,
      )
    } else {
      paragraphs.push(
        'The hotel has not recorded anything that answers this directly, so there is nothing reliable for me to pass on.',
      )
    }

    if (question.length > 0) {
      paragraphs.push(
        'This answer only repeats what the hotel and its partners have written down. Where it does not cover your question, the front desk will know more than I do.',
      )
    }

    return { paragraphs, citedPlaceIds: places.map((p) => String((p as { id?: unknown }).id ?? '')).filter(Boolean) }
  }

  private briefingNarrative(input: Record<string, unknown>): unknown {
    const arrivals = Number(input.arrivalsToday ?? 0)
    const gaps = Number(input.catalogGaps ?? 0)
    const approvals = Number(input.pendingApprovals ?? 0)
    const earnedMinor = Number(input.earnedTodayMinor ?? 0)

    const paragraphs: string[] = []
    paragraphs.push(
      arrivals === 0
        ? 'No arrivals today.'
        : `${arrivals} ${arrivals === 1 ? 'arrival' : 'arrivals'} today.`,
    )
    if (earnedMinor > 0) {
      paragraphs.push(
        'Yesterday’s experience earnings are shown separately from anything merely possible — the first figure is money, the second is a guess.',
      )
    }
    if (gaps > 0) {
      paragraphs.push(
        `${gaps} ${gaps === 1 ? 'amenity' : 'amenities'} still cannot be sold, which is the cheapest thing on this list to fix.`,
      )
    }
    if (approvals > 0) {
      paragraphs.push(
        `${approvals} drafted ${approvals === 1 ? 'action is' : 'actions are'} waiting on you. Nothing has been sent or changed.`,
      )
    }

    return { paragraphs }
  }

  private experienceBlurb(input: Record<string, unknown>): unknown {
    const title = typeof input.title === 'string' ? input.title : 'This experience'
    const summary = typeof input.summary === 'string' ? input.summary : ''
    // Hash the input so the "variation" is stable per experience rather than
    // random — a demo that reads differently on every reload looks broken.
    const variant = createHash('sha256').update(`${title}${summary}`).digest()[0] ?? 0
    const openers = [
      'Worth knowing:',
      'In short:',
      'The practical version:',
    ]
    const opener = openers[variant % openers.length] ?? openers[0]

    return { paragraphs: [`${opener} ${summary || title}.`] }
  }
}

/** Rough 4-chars-per-token heuristic. Good enough for cost telemetry. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
