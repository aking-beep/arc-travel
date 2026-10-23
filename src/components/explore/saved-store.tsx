'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
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

/*
 * `localStorage` as an external store, read through `useSyncExternalStore`.
 *
 * The export initialised `useState` by calling `localStorage.getItem` in the
 * initialiser, which runs during render — the impure read `CLAUDE.md` forbids
 * in a client component, and a throw under a server render, where there is no
 * `window`. Reading it in an effect instead fixes both but sets state
 * synchronously in an effect body, which is its own cascading-render problem
 * and which the linter rejects.
 *
 * `useSyncExternalStore` is the API for exactly this shape: a server snapshot
 * that is empty, a client snapshot read once and cached, and a subscription so
 * every mounted consumer re-renders on a write. The `storage` event comes for
 * free, so a save in one tab shows up in the others.
 */
type Listener = () => void

let cached: SavedState | null = null
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return
    cached = null
    emit()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** Cached, because `useSyncExternalStore` requires a referentially stable read. */
function getSnapshot(): SavedState {
  cached ??= readStored()
  return cached
}

const getServerSnapshot = (): SavedState => EMPTY

function write(next: SavedState): void {
  cached = next
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* Storage unavailable. The session still works, it just will not persist. */
  }
  emit()
}

const SavedContext = createContext<SavedContextValue | null>(null)

/**
 * Saved destinations, stays, experiences and itineraries, in this browser only.
 *
 * Nothing in here is sent to ARC. There is no account on the public surface,
 * so a save is a bookmark, not a hold and not an expression of intent we act
 * on. `modules/commerce` is where something becomes a commitment.
 */
export function SavedProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  // False on the server and through hydration, true once this is the client's
  // own render. Lets a consumer tell "nothing saved" from "not read yet"
  // without a state write in an effect.
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  const [toast, setToast] = useState<string | null>(null)

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
    const current = getSnapshot()
    const has = current[kind].includes(slug)
    write({
      ...current,
      [kind]: has ? current[kind].filter((x) => x !== slug) : [...current[kind], slug],
    })
    setToast(`${has ? 'Removed' : 'Saved'}${label ? ` ${label}` : ''}`)
  }, [])

  const saveItinerary = useCallback((itinerary: Itinerary) => {
    const current = getSnapshot()
    const exists = current.itineraries.some((x) => x.id === itinerary.id)
    write({
      ...current,
      itineraries: exists
        ? current.itineraries.map((x) => (x.id === itinerary.id ? itinerary : x))
        : [itinerary, ...current.itineraries],
    })
    setToast('Itinerary saved')
  }, [])

  const removeItinerary = useCallback((id: string) => {
    const current = getSnapshot()
    write({ ...current, itineraries: current.itineraries.filter((x) => x.id !== id) })
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
