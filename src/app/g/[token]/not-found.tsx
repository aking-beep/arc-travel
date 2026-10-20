import Link from 'next/link'

export default function PortalNotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-display text-xl font-semibold">This link is not valid</h1>
      <p className="text-sand-600 max-w-prose text-sm leading-relaxed">
        Portal links are tied to one stay and stop working once it is cancelled. If you are a guest,
        ask the front desk to scan you a new code.
      </p>
      <Link href="/" className="text-jade-800 text-sm underline underline-offset-4">
        ARC Stay
      </Link>
    </div>
  )
}
