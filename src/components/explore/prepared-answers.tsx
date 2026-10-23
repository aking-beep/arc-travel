'use client'

import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { CultureGuide } from '@/modules/discovery/content/culture'

interface Message {
  from: 'visitor' | 'guide'
  text: string
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
export function PreparedAnswers({ guide, name }: { guide: CultureGuide; name: string }) {
  const opening = `These are prepared notes on ${name}, written by ARC editors. Pick a question below, or type one and I will look for a prepared answer that matches.`

  const [messages, setMessages] = useState<Message[]>([{ from: 'guide', text: opening }])
  const [input, setInput] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // Reset when the destination changes under the component.
  useEffect(() => {
    setMessages([{ from: 'guide', text: opening }])
  }, [opening])

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

  const ask = (question: string) => {
    const trimmed = question.trim()
    if (!trimmed) return
    setMessages((current) => [
      ...current,
      { from: 'visitor', text: trimmed },
      { from: 'guide', text: findAnswer(trimmed) },
    ])
    setInput('')
  }

  return (
    <div className="bg-ink text-ivory flex flex-col overflow-hidden rounded-3xl">
      <div className="border-ivory/10 border-b p-6">
        <p className="text-2xl">Prepared answers</p>
        <p className="text-ivory/50 mt-1 text-xs leading-relaxed">
          A keyword match over notes ARC editors wrote. Nothing here is generated, and it will
          say so when it has no answer rather than offer the nearest one.
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
          </div>
        ))}
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto px-6 pb-3">
        {guide.faq.map((entry) => (
          <button
            key={entry.q}
            type="button"
            onClick={() => ask(entry.q)}
            className="border-ivory/20 hover:border-ivory/60 h-8 shrink-0 rounded-full border px-3 text-xs whitespace-nowrap transition-colors duration-150"
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
          className="bg-gold text-ink flex size-11 items-center justify-center rounded-full"
        >
          <Send className="size-4" aria-hidden />
        </button>
      </form>
    </div>
  )
}
