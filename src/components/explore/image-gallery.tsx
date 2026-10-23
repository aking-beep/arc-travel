'use client'

import Image from 'next/image'
import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Images, X } from 'lucide-react'

/**
 * Listing photography: a swipeable strip on phones, an editorial grid on
 * desktop, and a lightbox over both.
 *
 * The export's drag-to-dismiss came from framer-motion. This keeps the keyboard
 * path — arrows and Escape, which is what the lightbox actually needs to be
 * usable — and drops the drag rather than adding an animation library for it.
 *
 * `images` can be empty: ADR-025 put this surface's imagery on a third-party
 * CDN, so the page has to read correctly when it is not there.
 */
export function ImageGallery({ images, alt }: { images: string[]; alt: string }) {
  const [index, setIndex] = useState<number | null>(null)
  const count = images.length

  const step = useCallback(
    (delta: number) => setIndex((i) => (i === null ? null : (i + delta + count) % count)),
    [count],
  )

  useEffect(() => {
    if (index === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIndex(null)
      if (event.key === 'ArrowRight') step(1)
      if (event.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, step])

  // Lock the page behind the lightbox so a scroll gesture does not move it.
  useEffect(() => {
    if (index === null) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [index])

  if (count === 0) return null

  return (
    <>
      <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 md:hidden">
        {images.map((src, i) => (
          <button
            key={src}
            type="button"
            onClick={() => setIndex(i)}
            className="aspect-4/3 w-[88%] shrink-0 snap-center overflow-hidden rounded-2xl"
          >
            <div className="bg-sand relative size-full">
              <Image
                src={src}
                alt={`${alt} — ${i + 1} of ${count}`}
                fill
                sizes="88vw"
                className="object-cover"
              />
            </div>
          </button>
        ))}
      </div>

      <div className="relative hidden h-[520px] grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-3xl md:grid">
        {images.slice(0, 3).map((src, i) => (
          <button
            key={src}
            type="button"
            onClick={() => setIndex(i)}
            className={`group relative overflow-hidden ${i === 0 ? 'col-span-2 row-span-2' : 'col-span-2'}`}
          >
            <div className="bg-sand absolute inset-0">
              <Image
                src={src}
                alt={`${alt} — ${i + 1} of ${count}`}
                fill
                sizes="(max-width: 1280px) 50vw, 640px"
                className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              />
            </div>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setIndex(0)}
          className="bg-ivory text-ink hover:bg-paper absolute right-4 bottom-4 inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm shadow-sm transition-colors duration-150"
        >
          <Images className="size-4" aria-hidden /> View all {count} photos
        </button>
      </div>

      {index !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${alt} — photo gallery`}
          className="bg-ink/95 fixed inset-0 z-80 flex items-center justify-center"
        >
          <button
            type="button"
            onClick={() => setIndex(null)}
            className="bg-ivory/10 text-ivory absolute top-4 right-4 flex size-11 items-center justify-center rounded-full"
            aria-label="Close gallery"
            autoFocus
          >
            <X className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => step(-1)}
            className="bg-ivory/10 text-ivory absolute left-3 flex size-11 items-center justify-center rounded-full md:left-6"
            aria-label="Previous photo"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>

          <div className="relative size-full">
            <Image
              src={images[index]!}
              alt={`${alt} — ${index + 1} of ${count}`}
              fill
              sizes="92vw"
              className="object-contain p-10"
            />
          </div>

          <button
            type="button"
            onClick={() => step(1)}
            className="bg-ivory/10 text-ivory absolute right-3 flex size-11 items-center justify-center rounded-full md:right-6"
            aria-label="Next photo"
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
          <p className="text-ivory/70 absolute bottom-6 text-sm tabular-nums">
            {index + 1} / {count}
          </p>
        </div>
      ) : null}
    </>
  )
}
