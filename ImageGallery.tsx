import React, { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, X, Images } from 'lucide-react'

export function ImageGallery({ images, alt }: { images: string[]; alt: string }) {
  const [index, setIndex] = useState<number | null>(null)

  useEffect(() => {
    if (index === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIndex(null)
      if (e.key === 'ArrowRight') setIndex((i) => (i === null ? i : (i + 1) % images.length))
      if (e.key === 'ArrowLeft') setIndex((i) => (i === null ? i : (i - 1 + images.length) % images.length))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, images.length])

  return (
    <>
      {/* Mobile: swipeable strip */}
      <div className="md:hidden flex gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory -mx-5 px-5">
        {images.map((src, i) => (
          <button key={i} onClick={() => setIndex(i)} className="snap-center shrink-0 w-[88%] aspect-[4/3] rounded-2xl overflow-hidden">
            <img src={src} alt={`${alt} — photo ${i + 1}`} className="w-full h-full object-cover" />
          </button>
        ))}
      </div>

      {/* Desktop: editorial grid */}
      <div className="hidden md:grid grid-cols-4 grid-rows-2 gap-2 h-[520px] rounded-3xl overflow-hidden relative">
        {images.slice(0, 3).map((src, i) => (
          <button key={i} onClick={() => setIndex(i)} className={`relative overflow-hidden group ${i === 0 ? 'col-span-2 row-span-2' : 'col-span-2'}`}>
            <img src={src} alt={`${alt} — photo ${i + 1}`} className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.02]" />
          </button>
        ))}
        <button onClick={() => setIndex(0)} className="absolute bottom-4 right-4 inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ivory text-ink text-sm shadow-sm hover:bg-paper transition-colors duration-150">
          <Images className="w-4 h-4" /> View all {images.length} photos
        </button>
      </div>

      <AnimatePresence>
        {index !== null && (
          <motion.div
            className="fixed inset-0 z-[80] bg-ink/95 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            role="dialog"
            aria-label="Photo gallery"
          >
            <button onClick={() => setIndex(null)} className="absolute top-4 right-4 w-11 h-11 rounded-full bg-ivory/10 text-ivory flex items-center justify-center" aria-label="Close gallery"><X className="w-5 h-5" /></button>
            <button onClick={() => setIndex((index - 1 + images.length) % images.length)} className="absolute left-3 md:left-6 w-11 h-11 rounded-full bg-ivory/10 text-ivory flex items-center justify-center" aria-label="Previous photo"><ChevronLeft className="w-5 h-5" /></button>
            <motion.img
              key={index}
              src={images[index]}
              alt={`${alt} — photo ${index + 1}`}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              onDragEnd={(_, info) => {
                if (info.offset.x < -60) setIndex((index + 1) % images.length)
                if (info.offset.x > 60) setIndex((index - 1 + images.length) % images.length)
              }}
              className="max-w-[92%] max-h-[80%] object-contain rounded-lg"
            />
            <button onClick={() => setIndex((index + 1) % images.length)} className="absolute right-3 md:right-6 w-11 h-11 rounded-full bg-ivory/10 text-ivory flex items-center justify-center" aria-label="Next photo"><ChevronRight className="w-5 h-5" /></button>
            <p className="absolute bottom-6 text-ivory/70 text-sm tabular-nums">{index + 1} / {images.length}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
