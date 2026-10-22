import React from 'react'
import { motion } from 'framer-motion'
import { Heart } from 'lucide-react'
import { SavedKind, useSaved } from '../store/SavedContext'

type Props = { kind: SavedKind; slug: string; label: string; variant?: 'overlay' | 'inline' }

export function SaveButton({ kind, slug, label, variant = 'overlay' }: Props) {
  const { isSaved, toggle } = useSaved()
  const saved = isSaved(kind, slug)

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    toggle(kind, slug, label)
  }

  if (variant === 'inline') {
    return (
      <button
        onClick={onClick}
        aria-pressed={saved}
        className={`inline-flex items-center gap-2 h-11 px-5 rounded-full border text-sm whitespace-nowrap transition-colors duration-150 ${
          saved ? 'bg-ink text-ivory border-ink' : 'border-line bg-ivory text-ink hover:border-ink'
        }`}
      >
        <motion.span key={String(saved)} initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}>
          <Heart className={`w-4 h-4 ${saved ? 'fill-gold text-gold' : ''}`} />
        </motion.span>
        {saved ? 'Saved' : 'Save'}
      </button>
    )
  }

  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      transition={{ duration: 0.12 }}
      onClick={onClick}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${label} from saved` : `Save ${label}`}
      className="w-10 h-10 rounded-full bg-ivory/90 backdrop-blur flex items-center justify-center text-ink shadow-sm hover:bg-ivory transition-colors duration-150"
    >
      <Heart className={`w-[18px] h-[18px] ${saved ? 'fill-gold text-gold' : ''}`} />
    </motion.button>
  )
}
