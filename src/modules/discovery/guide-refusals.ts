/**
 * Subjects the local guide's answer panel refuses, whatever the notes say.
 *
 * Its own module, with no imports, for two reasons. It is a pure predicate and
 * belongs under unit test — `guide-answer.ts` reaches Prisma and the AI
 * harness at module load, which a `tests/unit` run has no database for. And
 * the guard is the part of that file with the most product in it:
 * non-negotiable 1 says never claim something is safe, non-negotiable 8 says
 * an advisory is never rendered as law, and a model holding month-old
 * editorial prose is the wrong thing to answer either from.
 *
 * It refuses crudely and in the right direction: it would rather turn away a
 * question it could have answered than let a safety question reach the model.
 * The one thing it must not do is swallow a question the panel invites, which
 * is a silent failure and is the shape of both bugs it has had.
 *
 * Three patterns rather than one:
 *
 * **`customs` is not a subject.** It sat in the whole-word list beside `visa`
 * and `border`, so "what are the local customs?" — a question the panel's own
 * opening line invites, about a section every guide has — came back as the
 * borders-and-health refusal. The border sense needs the words that go with
 * it, so it lives in `REFUSED_PHRASES`.
 *
 * **A stem is not a word.** `vaccin`, `medic` and `allerg` sat inside
 * `\b(…)\b`, and a trailing word boundary is exactly what a stem does not
 * have: "vaccinations", "medical" and "allergy" each walked past the guard
 * written for them. They are matched with a leading boundary only.
 *
 * `currents` is here in the plural only, and deliberately. The ocean sense is
 * almost always plural; the singular is mostly the adjective, and refusing
 * "what is the current season?" would be the `customs` mistake again.
 */
const REFUSED_WORDS =
  /\b(?:safe|safety|dangerous|danger|risk|risky|drown|rip ?currents?|rips?|currents|undertow|shark|avalanche|crevasse|surf (?:report|conditions)|swell|tide|visa|visas|passport|border|borders|legal|law|laws|arrest|police report|insurance claim|malaria|dengue|doctor|hospital|emergency)\b/i

const REFUSED_STEMS = /\b(?:vaccin|immunis|immuniz|medic|prescription|allerg|immigration|quarantin)/i

const REFUSED_PHRASES =
  /\b(?:through customs|customs (?:check|officer|declaration|form|allowance)|border control|entry requirement|declare at)/i

/** Whether a visitor's question is one of the refused subjects. */
export function isRefusedSubject(asked: string): boolean {
  return REFUSED_WORDS.test(asked) || REFUSED_STEMS.test(asked) || REFUSED_PHRASES.test(asked)
}
