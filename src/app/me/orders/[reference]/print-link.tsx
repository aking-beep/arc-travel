'use client'

import { Printer } from 'lucide-react'

/**
 * Print this page.
 *
 * The one thing a guest could not do with their confirmation was keep it.
 * This deployment records messages rather than sending them (ADR-040), so no
 * confirmation arrives in an inbox and the page itself is the receipt —
 * printing it, or saving it as a PDF, is the whole feature.
 *
 * A client component for one reason: `window.print()`. Nothing else here
 * needs the browser, and it reads no clock or other impure source during
 * render.
 */
export function PrintLink({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="text-sand-700 hover:text-jade-800 inline-flex items-center gap-1.5 text-sm underline underline-offset-4"
    >
      <Printer className="size-3.5" aria-hidden />
      {label}
    </button>
  )
}
