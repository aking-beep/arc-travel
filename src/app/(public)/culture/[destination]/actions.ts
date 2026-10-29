'use server'

import { answerFromGuide, type GuideAnswer } from '@/modules/discovery/guide-answer'

/**
 * Ask the local guide a question.
 *
 * Thin by design, per the layering rule: it hands two strings to one service
 * and returns what comes back. The destination is taken from the caller and
 * resolved against the content set inside the service, so an unknown slug
 * produces `null` rather than an answer about somewhere else.
 *
 * Returns `null` when the model is unconfigured, rate limited or failed. The
 * panel treats that as "fall back to the prepared answers", which is what it
 * did before a model existed — so an unset `ANTHROPIC_API_KEY` costs the page
 * nothing but the better answers.
 */
export async function askGuideAction(
  destination: string,
  question: string,
): Promise<GuideAnswer | null> {
  return answerFromGuide(destination, question)
}
