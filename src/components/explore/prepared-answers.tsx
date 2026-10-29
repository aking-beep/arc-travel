'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Send, Sparkles } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { CultureGuide } from '@/modules/discovery/content/culture'
import { askGuideAction } from '@/app/(public)/culture/[destination]/actions'

interface Message {
  from: 'visitor' | 'guide'
  text: string
  /**
   * How the answer was produced, so the panel can label it rather than let a
   * visitor assume. `prepared` is the keyword match; `ai` is a model that was
   * allowed to read only this destination's notes; `refused` is either of them
   * declining — which is a legitimate answer here and is shown as one.
   */
  via?: 'prepared' | 'ai' | 'refused'
  /** Prepared-answer questions the model leaned on, when it named any. */
  drawnFrom?: string[]
}

/**
 * How many question words must appear in an entry for it to count as a match.
 *
 * The export took the single best-scoring entry whenever any word overlapped at
 * all, so "is the surf good in December?" matched the tipping answer on the
 * word "December" appearing somewhere in its text and returned it with full
 * confidence. Two words is still crude, but it fails to the honest fallback
 * instead of to a confident wrong answer, which is the direction to fail in.
 */
const MIN_MATCH_WORDS = 2

/**
 * Prepared answers for a destination.
 *
 * This is the export's "Know Before You Go" widget, and it needed its framing
 * changed rather than its mechanism. The mechanism is a keyword count over a
 * hand-written FAQ — no model, no inference, nothing generated. The export
 * labelled it honestly in small print ("answers are pre-written by ARC
 * editors, not generated live") and then opened with "Ask me anything about
 * visiting {name} — tipping, dress, water, safety", which promises exactly
 * what it cannot do and solicits safety questions while doing so.
 *
 * So: the opening line says what this is, the fallback is reachable, and
 * nothing here invites a safety question. `CLAUDE.md` says the AI explains and
 * never decides; a keyword matcher dressed as an assistant is a step past
 * that, because it implies a model that is not there.
 */
export function PreparedAnswers({
  guide,
  name,
  destination,
}: {
  guide: CultureGuide
  name: string
  /** The slug, so the server action can resolve the same guide server-side. */
  destination: string
}) {
  const opening = `Ask me about ${name} — etiquette, customs, seasons, the language, what to expect. I answer from notes ARC editors wrote about this place and nothing else, and I will tell you when they do not cover something.`

  const [messages, setMessages] = useState<Message[]>([{ from: 'guide', text: opening }])
  const [input, setInput] = useState('')
  const [pending, startAsking] = useTransition()
  const listRef = useRef<HTMLDivElement>(null)

  // Reset when the destination changes under the component. Adjusted during
  // render rather than in an effect: React re-runs this component immediately
  // with the new state and never commits the stale conversation, where an
  // effect would paint the previous destination's thread first.
  const [lastOpening, setLastOpening] = useState(opening)
  if (lastOpening !== opening) {
    setLastOpening(opening)
    setMessages([{ from: 'guide', text: opening }])
  }

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  const findAnswer = (question: string): string => {
    const words = question
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > 3)

    let best = guide.faq[0]
    let bestScore = 0
    for (const entry of guide.faq) {
      const haystack = `${entry.q} ${entry.a}`.toLowerCase()
      const score = words.filter((word) => haystack.includes(word)).length
      if (score > bestScore) {
        bestScore = score
        best = entry
      }
    }

    if (bestScore >= MIN_MATCH_WORDS && best) return best.a
    return `There is no prepared answer for that. Rather than guess at one, here is what I can point you to: the questions below, the etiquette and seasons sections on this page, and the dated ocean readings on the local guide.`
  }

  /*
   * Ask the model, and fall back to the matcher.
   *
   * The deterministic answer is computed first and kept, so a model that is
   * unconfigured, rate limited, slow or broken costs this panel nothing: the
   * visitor gets the prepared answer they would always have got. The model is
   * an improvement on the answer, never a dependency of the page.
   *
   * A refusal is not a failure. `answerFromGuide` returns one for anything
   * about safety, conditions, law, borders or health, and it is shown as the
   * answer because it is the honest one.
   */
  const ask = (question: string) => {
    const trimmed = question.trim()
    if (!trimmed || pending) return

    const prepared = findAnswer(trimmed)
    setMessages((current) => [...current, { from: 'visitor', text: trimmed }])
    setInput('')

    startAsking(async () => {
      let answer: Awaited<ReturnType<typeof askGuideAction>> = null
      try {
        answer = await askGuideAction(destination, trimmed)
      } catch {
        answer = null
      }

      setMessages((current) => [
        ...current,
        answer
          ? {
              from: 'guide',
              text: answer.text,
              via: answer.source,
              drawnFrom: answer.drawnFrom,
            }
          : { from: 'guide', text: prepared, via: 'prepared' },
      ])
    })
  }

  return (
    <div className="bg-ink text-ivory flex flex-col overflow-hidden rounded-3xl">
      <div className="border-ivory/10 border-b p-6">
        <p className="text-2xl">Ask the local guide</p>
        <p className="text-ivory/50 mt-1 text-xs leading-relaxed">
          {/*
            Worded around the phrase it refuses, deliberately. Saying "it will
            not tell you whether anything is safe" puts "is safe" on a page
            about a real beach, and `07-explore-surface` greps the rendered
            body for exactly that — the guard is right, and this panel has no
            business printing the string even to disclaim it.
          */}
          Answered from notes ARC editors wrote about this place, and nothing else. It will not
          judge safety, describe what the sea is doing today, or answer anything about law, borders
          or health — those need a current source, and it will say so.
        </p>
      </div>

      <div ref={listRef} className="h-80 space-y-3 overflow-y-auto p-6" aria-live="polite">
        {messages.map((message, index) => (
          <div
            key={`${message.from}-${index}`}
            className={cn(
              'max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
              message.from === 'visitor' ? 'bg-gold text-ink ml-auto' : 'bg-ivory/10',
            )}
          >
            {message.text}
            {message.drawnFrom && message.drawnFrom.length > 0 ? (
              <span className="text-ivory/40 mt-2 block text-xs">
                From the notes on: {message.drawnFrom.join(' · ')}
              </span>
            ) : null}
            {message.via === 'ai' ? (
              <span className="text-ivory/40 mt-2 flex items-center gap-1 text-xs">
                <Sparkles className="size-3" aria-hidden />
                Written from the editors&rsquo; notes
              </span>
            ) : null}
          </div>
        ))}
        {pending ? (
          <div className="bg-ivory/10 text-ivory/60 max-w-[88%] rounded-2xl px-4 py-3 text-sm">
            Reading the notes…
          </div>
        ) : null}
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto px-6 pb-3">
        {guide.faq.map((entry) => (
          <button
            key={entry.q}
            type="button"
            onClick={() => ask(entry.q)}
            disabled={pending}
            className="border-ivory/20 hover:border-ivory/60 h-8 shrink-0 rounded-full border px-3 text-xs whitespace-nowrap transition-colors duration-150 disabled:opacity-50"
          >
            {entry.q}
          </button>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          ask(input)
        }}
        className="flex gap-2 p-4 pt-2"
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Type a question…"
          className="bg-ivory/10 placeholder:text-ivory/40 focus:bg-ivory/15 h-11 flex-1 rounded-full px-4 text-sm outline-none"
          aria-label="Ask a question"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={pending}
          className="bg-gold text-ink flex size-11 items-center justify-center rounded-full disabled:opacity-50"
        >
          <Send className="size-4" aria-hidden />
        </button>
      </form>
    </div>
  )
}
