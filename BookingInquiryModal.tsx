import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X, MailCheck, Minus, Plus } from 'lucide-react'
import { useSaved } from '../store/SavedContext'
import { money } from './ui'

type Props = {
  open: boolean
  onClose: () => void
  kind: 'stay' | 'experience'
  slug: string
  title: string
  subtitle?: string
  startDate: string
  endDate?: string
  travelers: number
  /** Re-computes the estimate as the guest edits dates/travellers. */
  estimate: (start: string, end: string | undefined, travelers: number) => number
}

export function BookingInquiryModal(props: Props) {
  const { open, onClose, kind, slug, title, subtitle, estimate } = props
  const { addInquiry } = useSaved()
  const [start, setStart] = useState(props.startDate)
  const [end, setEnd] = useState(props.endDate)
  const [guests, setGuests] = useState(props.travelers)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [flex, setFlex] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (open) {
      setStart(props.startDate); setEnd(props.endDate); setGuests(props.travelers); setSent(false); setErrors({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const est = estimate(start, end, guests)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = 'Please add your name'
    if (!/^\S+@\S+\.\S+$/.test(email)) errs.email = 'Please enter a valid email'
    if (!start) errs.start = 'Choose a date'
    if (kind === 'stay' && (!end || end <= start)) errs.end = 'Departure must be after arrival'
    setErrors(errs)
    if (Object.keys(errs).length) return
    addInquiry({ id: `inq-${Date.now()}`, kind, slug, title, startDate: start, endDate: kind === 'stay' ? end : undefined, travelers: guests, estimate: est, name, email, message: (flex ? '[Flexible dates] ' : '') + message, createdAt: new Date().toISOString() })
    setSent(true)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <button className="absolute inset-0 bg-ink/50" onClick={onClose} aria-label="Close inquiry" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`Booking inquiry for ${title}`}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            className="relative w-full md:max-w-lg max-h-[92%] overflow-y-auto bg-ivory rounded-t-3xl md:rounded-3xl p-6 md:p-8"
          >
            <button onClick={onClose} className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center hover:bg-paper" aria-label="Close"><X className="w-5 h-5" /></button>

            {sent ? (
              <div className="py-6 text-center">
                <MailCheck className="w-10 h-10 mx-auto text-sage" />
                <p className="font-serif text-3xl mt-4">Inquiry recorded</p>
                <p className="mt-3 text-sm text-muted leading-relaxed max-w-sm mx-auto">
                  In this prototype nothing is sent and <strong className="text-ink font-medium">no reservation or payment</strong> is made. Your inquiry for {title} is saved to My Trips so you can track it.
                </p>
                <div className="mt-8 flex justify-center gap-3">
                  <Link to="/trips" onClick={onClose} className="h-11 px-5 rounded-full bg-ink text-ivory text-sm inline-flex items-center">View in My Trips</Link>
                  <button onClick={onClose} className="h-11 px-5 rounded-full border border-line text-sm">Close</button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} noValidate>
                <p className="text-sm text-gold-deep">Booking inquiry</p>
                <h2 className="font-serif text-3xl mt-1 pr-10 leading-tight">{title}</h2>
                {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}

                <div className={`mt-6 grid gap-3 ${kind === 'stay' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <Input label={kind === 'stay' ? 'Arrive' : 'Date'} type="date" value={start} onChange={setStart} error={errors.start} />
                  {kind === 'stay' && <Input label="Depart" type="date" value={end ?? ''} min={start} onChange={setEnd} error={errors.end} />}
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-muted cursor-pointer">
                  <input type="checkbox" checked={flex} onChange={(e) => setFlex(e.target.checked)} className="accent-[#52685B]" /> My dates are flexible by a few days
                </label>

                <div className="mt-5 flex items-center justify-between border-y border-line py-4">
                  <span className="text-sm">Travellers</span>
                  <div className="flex items-center gap-4">
                    <button type="button" onClick={() => setGuests(Math.max(1, guests - 1))} aria-label="Fewer" className="w-9 h-9 rounded-full border border-line flex items-center justify-center"><Minus className="w-3.5 h-3.5" /></button>
                    <span className="w-4 text-center tabular-nums">{guests}</span>
                    <button type="button" onClick={() => setGuests(Math.min(12, guests + 1))} aria-label="More" className="w-9 h-9 rounded-full border border-line flex items-center justify-center"><Plus className="w-3.5 h-3.5" /></button>
                  </div>
                </div>

                <div className="mt-5 grid gap-3">
                  <Input label="Your name" value={name} onChange={setName} error={errors.name} />
                  <Input label="Email" type="email" value={email} onChange={setEmail} error={errors.email} />
                  <label className="block">
                    <span className="text-xs text-muted">Message to host (optional)</span>
                    <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Celebrating something? Dietary needs? Surf level?" className="mt-1 block w-full border border-line rounded-xl px-4 py-3 text-sm bg-ivory outline-none focus:border-ink resize-none" />
                  </label>
                </div>

                <div className="mt-6 flex items-baseline justify-between">
                  <span className="text-sm text-muted">Estimated total</span>
                  <span className="font-serif text-2xl tabular-nums">{money(est)}</span>
                </div>
                <button type="submit" className="mt-5 w-full h-12 rounded-full bg-ink text-ivory text-sm hover:bg-ink-soft transition-colors duration-150">Send inquiry</button>
                <p className="mt-3 text-xs text-muted text-center">No payment taken. The host replies with availability before anything is booked.</p>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Input({ label, value, onChange, type = 'text', error, min }: { label: string; value: string; onChange: (v: string) => void; type?: string; error?: string; min?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      <input type={type} value={value} min={min} onChange={(e) => onChange(e.target.value)} className={`mt-1 block w-full border rounded-xl px-4 h-12 text-sm bg-ivory outline-none focus:border-ink ${error ? 'border-danger' : 'border-line'}`} />
      {error && <span className="block text-xs text-danger mt-1">{error}</span>}
    </label>
  )
}
