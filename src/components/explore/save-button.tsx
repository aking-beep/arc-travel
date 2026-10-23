'use client'

import { Heart } from 'lucide-react'
import { cn } from '@/lib/cn'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import { useSaved, type SavedKind } from './saved-store'

/**
 * Save a listing to this browser.
 *
 * The export animated the heart with framer-motion. This uses a CSS transition
 * instead: the repo carries no animation library, the motion here is
 * decorative, and `prefers-reduced-motion` already neutralises transitions
 * globally in `globals.css`.
 */
export function SaveButton({
  kind,
  slug,
  label,
  locale,
  variant = 'overlay',
}: {
  kind: SavedKind
  slug: string
  label: string
  locale: AppLocale
  variant?: 'overlay' | 'inline'
}) {
  const t = createTranslator(locale)
  const { isSaved, toggle, ready } = useSaved()
  const saved = isSaved(kind, slug)

  const onClick = (event: React.MouseEvent) => {
    // These sit inside a link to the listing, so a save must not navigate.
    event.preventDefault()
    event.stopPropagation()
    toggle(kind, slug, label)
  }

  const ariaLabel = saved
    ? t('explore.saved.removeA', { name: label })
    : t('explore.saved.saveA', { name: label })

  if (variant === 'inline') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={saved}
        aria-label={ariaLabel}
        className={cn(
          'inline-flex h-11 items-center gap-2 rounded-full border px-5 text-sm whitespace-nowrap transition-colors duration-150',
          saved
            ? 'bg-ink text-ivory border-ink'
            : 'border-line bg-ivory text-ink hover:border-ink',
        )}
      >
        <Heart
          className={cn('size-4 transition-transform duration-150', saved && 'fill-gold text-gold')}
          aria-hidden
        />
        {saved ? t('explore.saved.saved') : t('explore.saved.save')}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={saved}
      aria-label={ariaLabel}
      // Hidden from assistive tech until the stored set is known, so it never
      // announces "not saved" for something the visitor saved earlier.
      aria-busy={!ready}
      className="bg-ivory/90 text-ink hover:bg-ivory flex size-10 items-center justify-center rounded-full shadow-sm backdrop-blur transition-colors duration-150 active:scale-90"
    >
      <Heart className={cn('size-[18px]', saved && 'fill-gold text-gold')} aria-hidden />
    </button>
  )
}
