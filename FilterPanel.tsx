import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'

export type FilterGroup = {
  id: string
  label: string
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
}

type Props = {
  groups: FilterGroup[]
  children?: React.ReactNode
  onClear: () => void
  activeCount: number
  /** Mobile drawer state */
  open: boolean
  onClose: () => void
  resultCount: number
}

/** Sidebar on desktop, bottom-sheet drawer on mobile. */
export function FilterPanel({ groups, children, onClear, activeCount, open, onClose, resultCount }: Props) {
  const body = (
    <div className="space-y-8">
      {children}
      {groups.map((g) => (
        <fieldset key={g.id}>
          <legend className="text-sm font-medium mb-3">{g.label}</legend>
          <div className="space-y-1">
            {g.options.map((o) => {
              const checked = g.selected.includes(o)
              return (
                <label key={o} className="flex items-center gap-3 py-1.5 cursor-pointer text-sm text-ink-soft">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => g.onToggle(o)}
                    className="w-4 h-4 accent-[#52685B] rounded"
                  />
                  {o}
                </label>
              )
            })}
          </div>
        </fieldset>
      ))}
      {activeCount > 0 && (
        <button onClick={onClear} className="text-sm text-gold-deep underline underline-offset-4">
          Clear all filters ({activeCount})
        </button>
      )}
    </div>
  )

  return (
    <>
      <aside className="hidden lg:block w-64 shrink-0">{body}</aside>
      <AnimatePresence>
        {open && (
          <motion.div className="lg:hidden fixed inset-0 z-[70]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <button aria-label="Close filters" className="absolute inset-0 bg-ink/40" onClick={onClose} />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.5 }}
              onDragEnd={(_, info) => info.offset.y > 120 && onClose()}
              className="absolute bottom-0 inset-x-0 max-h-[85%] bg-ivory rounded-t-3xl flex flex-col"
            >
              <div className="flex items-center justify-between px-5 pt-3 pb-4 border-b border-line">
                <div className="w-10 h-1 rounded-full bg-line absolute left-1/2 -translate-x-1/2 top-2" />
                <p className="font-serif text-xl mt-2">Filters</p>
                <button onClick={onClose} className="w-10 h-10 flex items-center justify-center mt-2" aria-label="Close"><X className="w-5 h-5" /></button>
              </div>
              <div className="overflow-y-auto px-5 py-6 flex-1">{body}</div>
              <div className="p-4 border-t border-line">
                <button onClick={onClose} className="w-full h-12 rounded-full bg-ink text-ivory text-sm">Show {resultCount} results</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
