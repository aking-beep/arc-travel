'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Itinerary } from '@/modules/discovery/content/types'

export type SavedKind = 'destinations' | 'stays' | 'experiences'

interface SavedState {
  destinations: string[]
  stays: string[]
  experiences: string[]
  itineraries: Itinerary[]
}

interface SavedContextValue extends SavedState {
  /** False until the stored state has been read, so nothing flashes. */
  ready: boolean
  isSaved: (kind: SavedKind, slug: string) => boolean
  toggle: (kind: SavedKind, slug: string, label?: string) => void
  saveItinerary: (itinerary: Itinerary) => void
  removeItinerary: (id: string) => void
  count: number
  toast: string | null
  notify: (message: string) => void
}

const STORAGE_KEY = 'arc-travel:v1'
const EMPTY: SavedState = { destinations: [], stays: [], experiences: [], itineraries: [] }

const SavedContext = createContext<SavedContextValue | null>(null)

function readStored(): SavedState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY

    // Stored state is whatever was in this browser the last time a possibly
    // older build wrote it, so each field is checked rather than trusted.
    const candidate = parsed as Partial<SavedState>
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

    return {
      destinations: strings(candidate.destinations),
      stays: strings(candidate.stays),
      experiences: strings(candidate.experiences),
      itineraries: Array.isArray(candidate.itineraries) ? candidate.itineraries : [],
    }
  } catch {
    // Private browsing, blocked site data, or malformed JSON. An empty set is
    // the right answer to all three and none of them is an error worth showing.
    return EMPTY
  }
}

/**
 * Saved destinations, stays, experiences and itineraries, in this browser only.
 *
 * The export initialised `useState` by calling `localStorage.getItem` in the
 * initialiser, which runs during render. That is the thing `CLAUDE.md` forbids
 * for client components — an impure read during render — and under a server
 * render it would also have thrown, because there is no `window`. So the first
 * render here is deliberately empty and the stored state arrives in an effect.
 * `ready` exists so a consumer can tell "nothing saved" from "not read yet"
 * and render an empty state rather than a flash of the wrong one.
 *
 * Nothing in here is sent to ARC. There is no account on the public surface,
 * so a save is a bookmark, not a hold and not an expression of intent we act
 * on. `modules/commerce` is where something becomes a commitment.
 */
export function SavedProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SavedState>(EMPTY)
  const [ready, setReady] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    setState(readStored())
    setReady(true)
  }, [])

  // Only write back once the initial read has happened, or the empty first
  // render would overwrite what the visitor had saved.
  useEffect(() => {
    if (!ready) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* Storage unavailable. The session still works, it just will not persist. */
    }
  }, [state, ready])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2400)
    return () => window.clearTimeout(timer)
  }, [toast])

  const notify = useCallback((message: string) => setToast(message), [])

  const isSaved = useCallback(
    (kind: SavedKind, slug: string) => state[kind].includes(slug),
    [state],
  )

  const toggle = useCallback((kind: SavedKind, slug: string, label?: string) => {
    setState((current) => {
      const has = current[kind].includes(slug)
      const suffix = label ? ` ${label}` : ''
      setToast(has ? `Removed${suffix}` : `Saved${suffix}`)
      return {
        ...current,
        [kind]: has ? current[kind].filter((x) => x !== slug) : [...current[kind], slug],
      }
    })
  }, [])

  const saveItinerary = useCallback((itinerary: Itinerary) => {
    setState((current) => {
      const exists = current.itineraries.some((x) => x.id === itinerary.id)
      return {
        ...current,
        itineraries: exists
          ? current.itineraries.map((x) => (x.id === itinerary.id ? itinerary : x))
          : [itinerary, ...current.itineraries],
      }
    })
    setToast('Itinerary saved')
  }, [])

  const removeItinerary = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      itineraries: current.itineraries.filter((x) => x.id !== id),
    }))
    setToast('Itinerary removed')
  }, [])

  const value = useMemo<SavedContextValue>(
    () => ({
      ...state,
      ready,
      isSaved,
      toggle,
      saveItinerary,
      removeItinerary,
      count:
        state.destinations.length +
        state.stays.length +
        state.experiences.length +
        state.itineraries.length,
      toast,
      notify,
    }),
    [state, ready, isSaved, toggle, saveItinerary, removeItinerary, toast, notify],
  )

  return <SavedContext.Provider value={value}>{children}</SavedContext.Provider>
}

export function useSaved(): SavedContextValue {
  const context = useContext(SavedContext)
  if (!context) throw new Error('useSaved must be used inside a SavedProvider.')
  return context
}
