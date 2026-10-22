import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Send } from 'lucide-react'
import { CultureGuide } from '../data/culture'

type Msg = { from: 'user' | 'guide'; text: string }

/** Prototype assistant: matches questions against predefined answers. No live model. */
export function KnowBeforeYouGo({ guide, name }: { guide: CultureGuide; name: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([{ from: 'guide', text: `Ask me anything about visiting ${name} — tipping, dress, water, safety. Pick a question or type your own.` }])
  const [input, setInput] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMsgs([{ from: 'guide', text: `Ask me anything about visiting ${name} — tipping, dress, water, safety. Pick a question or type your own.` }])
  }, [name])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [msgs])

  const answer = (q: string) => {
    const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 3)
    let best = guide.faq[0], score = 0
    for (const f of guide.faq) {
      const hay = (f.q + ' ' + f.a).toLowerCase()
      const s = words.filter((w) => hay.includes(w)).length
      if (s > score) { score = s; best = f }
    }
    return score > 0 ? best.a : `I don’t have a prepared answer for that yet. Try one of the suggested questions, or check the etiquette and safety sections on this page.`
  }

  const ask = (q: string) => {
    if (!q.trim()) return
    setMsgs((m) => [...m, { from: 'user', text: q }, { from: 'guide', text: answer(q) }])
    setInput('')
  }

  return (
    <div className="bg-ink text-ivory rounded-3xl overflow-hidden flex flex-col">
      <div className="p-6 border-b border-ivory/10">
        <p className="font-serif text-2xl">Know Before You Go</p>
        <p className="text-xs text-ivory/50 mt-1">Prototype assistant · answers are pre-written by ARC editors, not generated live.</p>
      </div>
      <div ref={listRef} className="p-6 space-y-3 h-80 overflow-y-auto" aria-live="polite">
        {msgs.map((m, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            className={`max-w-[88%] text-sm leading-relaxed rounded-2xl px-4 py-3 ${m.from === 'user' ? 'ml-auto bg-gold text-ink' : 'bg-ivory/10'}`}
          >
            {m.text}
          </motion.div>
        ))}
      </div>
      <div className="px-6 pb-3 flex gap-2 overflow-x-auto no-scrollbar">
        {guide.faq.map((f) => (
          <button key={f.q} onClick={() => ask(f.q)} className="shrink-0 text-xs px-3 h-8 rounded-full border border-ivory/20 hover:border-ivory/60 whitespace-nowrap transition-colors duration-150">{f.q}</button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(input) }} className="p-4 pt-2 flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a question…" className="flex-1 h-11 rounded-full bg-ivory/10 px-4 text-sm placeholder:text-ivory/40 outline-none focus:bg-ivory/15" aria-label="Ask a question" />
        <button aria-label="Send" className="w-11 h-11 rounded-full bg-gold text-ink flex items-center justify-center"><Send className="w-4 h-4" /></button>
      </form>
    </div>
  )
}
