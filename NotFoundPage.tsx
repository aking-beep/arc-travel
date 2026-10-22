import React from 'react'
import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 py-32 text-center">
      <p className="font-serif text-6xl">Off the map.</p>
      <p className="mt-4 text-muted">We couldn’t find that page. It may have moved, or the link may be mistyped.</p>
      <div className="mt-8 flex justify-center gap-3">
        <Link to="/" className="h-11 px-5 rounded-full bg-ink text-ivory text-sm inline-flex items-center">Back home</Link>
        <Link to="/destinations" className="h-11 px-5 rounded-full border border-line text-sm inline-flex items-center">Browse destinations</Link>
      </div>
    </div>
  )
}
