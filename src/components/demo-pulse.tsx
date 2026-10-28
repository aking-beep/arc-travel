'use client'

import { useEffect, useRef } from 'react'

/**
 * Keeps the town moving while somebody is watching it.
 *
 * The demo's baseline clock is a scheduled job every few minutes, which is the
 * right pace for a marketplace nobody is looking at and far too slow for one
 * somebody is. This posts to `/api/simulation/tick` while the tab is visible,
 * so an owner clicking through arrivals and revenue sees things *arrive*.
 *
 * Three things keep it modest: it renders nothing, it stops the moment the tab
 * is hidden (a laptop with the demo in a background tab is not a cost centre),
 * and the deployment holds the real budget — the route refuses past a global
 * ticks-per-minute ceiling, so this interval is a request, not a guarantee.
 *
 * Mounted from `DemoBanner`, which is already on every surface and already
 * renders only while `ARC_DATA_MODE=demo`.
 */
const PULSE_MS = 20_000

export function DemoPulse() {
  const inFlight = useRef(false)

  useEffect(() => {
    let cancelled = false

    const pulse = async () => {
      if (cancelled || inFlight.current) return
      if (document.visibilityState !== 'visible') return
      inFlight.current = true
      try {
        await fetch('/api/simulation/tick', { method: 'POST' })
      } catch {
        // A heartbeat that fails is a heartbeat that beats again in twenty
        // seconds. Nothing on screen depends on this request.
      } finally {
        inFlight.current = false
      }
    }

    const beat = () => void pulse()

    // A first beat on mount, so opening a page does something immediately.
    beat()
    const timer = window.setInterval(beat, PULSE_MS)
    document.addEventListener('visibilitychange', beat)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', beat)
    }
  }, [])

  return null
}
