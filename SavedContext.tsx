import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Itinerary } from '../data/types'

export type SavedKind = 'destinations' | 'stays' | 'experiences'

export type Inquiry = {
  id: string
  kind: 'stay' | 'experience'
  slug: string
  title: string
  startDate: string
  endDate?: string
  travelers: number
  estimate: number
  name: string
  email: string
  message: string
  createdAt: string
}

type State = {
  destinations: string[]
  stays: string[]
  experiences: string[]
  itineraries: Itinerary[]
  inquiries: Inquiry[]
}

type Ctx = State & {
  isSaved: (kind: SavedKind, slug: string) => boolean
  toggle: (kind: SavedKind, slug: string, label?: string) => void
  saveItinerary: (it: Itinerary) => void
  removeItinerary: (id: string) => void
  addInquiry: (inq: Inquiry) => void
  removeInquiry: (id: string) => void
  toast: string | null
  notify: (msg: string) => void
}

const KEY = 'arc-travel:v1'
const empty: State = { destinations: [], stays: [], experiences: [], itineraries: [], inquiries: [] }

const SavedContext = createContext<Ctx | null>(null)

export function SavedProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>(() => {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? { ...empty, ...JSON.parse(raw) } : empty
    } catch {
      return empty
    }
  })
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* storage unavailable */
    }
  }, [state])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2400)
    return () => clearTimeout(t)
  }, [toast])

  const notify = useCallback((msg: string) => setToast(msg), [])

  const isSaved = useCallback((kind: SavedKind, slug: string) => state[kind].includes(slug), [state])

  const toggle = useCallback((kind: SavedKind, slug: string, label?: string) => {
    const has = state[kind].includes(slug)
    setToast(has ? `Removed${label ? ` ${label}` : ''} from My Trips` : `Saved${label ? ` ${label}` : ''} to My Trips`)
    setState((s) => ({ ...s, [kind]: s[kind].includes(slug) ? s[kind].filter((x) => x !== slug) : [...s[kind], slug] }))
  }, [state])

  const saveItinerary = useCallback((it: Itinerary) => {
    setState((s) => {
      const exists = s.itineraries.some((x) => x.id === it.id)
      return { ...s, itineraries: exists ? s.itineraries.map((x) => (x.id === it.id ? it : x)) : [it, ...s.itineraries] }
    })
    setToast('Itinerary saved to My Trips')
  }, [])

  const removeItinerary = useCallback((id: string) => {
    setState((s) => ({ ...s, itineraries: s.itineraries.filter((x) => x.id !== id) }))
    setToast('Itinerary removed')
  }, [])

  const addInquiry = useCallback((inq: Inquiry) => setState((s) => ({ ...s, inquiries: [inq, ...s.inquiries] })), [])
  const removeInquiry = useCallback((id: string) => {
    setState((s) => ({ ...s, inquiries: s.inquiries.filter((x) => x.id !== id) }))
    setToast('Inquiry withdrawn')
  }, [])

  const value = useMemo(
    () => ({ ...state, isSaved, toggle, saveItinerary, removeItinerary, addInquiry, removeInquiry, toast, notify }),
    [state, isSaved, toggle, saveItinerary, removeItinerary, addInquiry, removeInquiry, toast, notify],
  )

  return <SavedContext.Provider value={value}>{children}</SavedContext.Provider>
}

export function useSaved() {
  const ctx = useContext(SavedContext)
  if (!ctx) throw new Error('useSaved must be used inside SavedProvider')
  return ctx
}
