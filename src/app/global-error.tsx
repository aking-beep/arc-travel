'use client'

import './globals.css'

/**
 * The last boundary: an error in the root layout itself.
 *
 * `error.tsx` renders *inside* the root layout, so it cannot catch a failure in
 * the layout — and the layout reads the locale cookie, so it is not a file that
 * cannot fail. This replaces the whole document, which is why it carries its
 * own `<html>` and `<body>`.
 *
 * It is deliberately plainer than `error.tsx` and takes no dependency on
 * anything that could be the thing that broke.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-5 py-12">
          <h1 className="font-display text-2xl font-semibold">ARC Stay is unavailable</h1>
          <p className="text-sm">
            Something failed before the page could be built. Nothing has been charged or confirmed.
          </p>
          {/*
            * A plain anchor, not `next/link`, and the lint rule is waived
            * rather than satisfied: a client-side navigation would keep the
            * React tree whose root layout is the thing that just failed. A
            * full document load is the only way out of here.
            */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="text-sm font-medium underline underline-offset-4">
            Start again
          </a>
          {error.digest ? (
            <p className="text-xs">
              Reference <code className="font-mono">{error.digest}</code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  )
}
