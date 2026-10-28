/**
 * Reading a page for the two claims the product promises never to make.
 *
 * Naive substring matching gets both of these backwards, and did: searching for
 * "is safe" matched the disclaimer "it cannot tell you a beach is safe", and
 * searching for "verified by arc" matched the badge "Not verified by ARC". Both
 * were reported as the product making a claim it was in fact refusing to make.
 *
 * So both readers here strip the refusals first and then look for an
 * *affirmative* statement, and both return the surrounding text so a person can
 * judge the match rather than trusting the regex.
 */

/** Sentences that are the product declining to make the claim. */
const SAFETY_REFUSALS = [
  /it cannot tell you (a|the) beach is safe/gi,
  /cannot tell you whether[^.]{0,60}safe/gi,
  /never tells you[^.]{0,60}safe/gi,
  /does not tell you[^.]{0,60}safe/gi,
  /we (do not|don’t|don't) say[^.]{0,40}safe/gi,
  /no[^.]{0,20}safety claim/gi,
]

const SAFETY_CLAIMS = [
  /\b(is|are|it’s|it's|looks|stays|remains)\s+safe\b/gi,
  /\bsafe\s+(today|to swim|to surf|for (you|beginners|children|kids|your))/gi,
  /\bsafe conditions\b/gi,
  /\bperfectly safe\b/gi,
  /\bsafe (beach|break|spot)\b/gi,
]

const VERIFICATION_WORDS = /\b(verified|vetted|arc[- ]approved|arc[- ]checked)\b/gi

/** Words right before a verification word that make it a refusal or a process note. */
const VERIFICATION_NEGATIONS =
  /(not|never|no|none|nobody|nothing|un|isn’t|isn't|aren’t|aren't|cannot|can’t|can't|yet to be|awaiting|pending|only arc can mark a business as|only route to a|means you have seen|before a partner can be|route to a)\s*$/i

export interface ClaimHit {
  match: string
  context: string
}

function hits(text: string, patterns: RegExp[]): ClaimHit[] {
  const found: ClaimHit[] = []
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      const at = m.index ?? 0
      found.push({
        match: m[0],
        context: text.slice(Math.max(0, at - 90), at + m[0].length + 60).replace(/\s+/g, ' '),
      })
    }
  }
  return found
}

/** Affirmative safety claims on a page, with the refusals removed first. */
export function safetyClaims(pageText: string): ClaimHit[] {
  let text = pageText
  for (const refusal of SAFETY_REFUSALS) text = text.replace(refusal, ' [refusal] ')
  return hits(text, SAFETY_CLAIMS)
}

/** Statements that something has been verified, with refusals and process notes removed. */
export function verificationClaims(pageText: string): ClaimHit[] {
  const found: ClaimHit[] = []
  for (const m of pageText.matchAll(VERIFICATION_WORDS)) {
    const at = m.index ?? 0
    const before = pageText.slice(Math.max(0, at - 40), at)
    if (VERIFICATION_NEGATIONS.test(before)) continue
    found.push({
      match: m[0],
      context: pageText.slice(Math.max(0, at - 90), at + m[0].length + 60).replace(/\s+/g, ' '),
    })
  }
  return found
}

export const describe = (found: ClaimHit[]): string =>
  found.map((h) => `“${h.match}” in: …${h.context}…`).join(' | ').slice(0, 900)
