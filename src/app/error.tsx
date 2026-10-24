'use client'

import Link from 'next/link'

/**
 * The error state for every route that does not define its own.
 *
 * CLAUDE.md requires a loading, empty and error state on every list and panel,
 * on the grounds that a blank panel cannot tell an owner "no arrivals today"
 * from "this is broken". The same argument applies a level up and there was no
 * route-level boundary at all, so an unhandled server error produced Next's
 * default page — which in production is an unstyled "Application error" with
 * no way back.
 *
 * It deliberately shows nothing about the error. `error.message` is scrubbed by
 * Next in production, but `digest` is not, and neither is a message this
 * component could be passed in development; an error page is read by guests on
 * a phone, and the detail belongs in the report `src/instrumentation.ts` sends,
 * not on the screen. The digest is shown because it is the handle that
 * connects what the guest saw to that report.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-5 py-12">
      <h1 className="font-display text-jade-900 text-2xl font-semibold">
        Something went wrong at our end
      </h1>
      <p className="text-sand-700 text-sm">
        Nothing you were doing has been charged or confirmed. Try again — if it keeps happening,
        the property can help.
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="bg-jade-900 hover:bg-jade-800 rounded-lg px-4 py-2 text-sm font-medium text-white"
        >
          Try again
        </button>
        <Link
          href="/"
          className="border-sand-300 text-sand-800 hover:bg-sand-100 rounded-lg border px-4 py-2 text-sm font-medium"
        >
          Start again
        </Link>
      </div>

      {error.digest ? (
        <p className="text-sand-500 text-xs">
          Reference <code className="font-mono">{error.digest}</code> — quote this if you report it.
        </p>
      ) : null}
    </main>
  )
}
