import Link from 'next/link'
import { ArrowRight, Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import type { AppLocale } from '@/lib/i18n'
import { createTranslator } from '@/lib/i18n'
import type { ListingStatus } from '@/modules/discovery/content/types'

/**
 * Shared presentation for the public destination surface.
 *
 * The export kept these in a `ui.tsx` that also exported a money formatter.
 * The formatter is gone — money renders through `<Money>`, which carries the
 * demo marker and the earned/potential intent — and what is left here is
 * presentational only.
 */

/**
 * What a listing is.
 *
 * The export rendered a green "Verified partner" badge from a field its own
 * fixtures set, which is the claim this product exists not to make. Every
 * listing in this content set is illustrative, so this renders one thing, and
 * the type makes a second branch unreachable rather than merely unused. When a
 * real `VerificationStatus` reaches this surface it will come from a row an
 * admin wrote, and it will need its own component.
 */
export function ListingBadge({
  status,
  locale,
  onImage = false,
  className,
}: {
  status: ListingStatus
  locale: AppLocale
  onImage?: boolean
  className?: string
}) {
  const t = createTranslator(locale)
  void status

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium whitespace-nowrap',
        onImage ? 'bg-ink/70 text-ivory backdrop-blur' : 'bg-paper text-muted',
        className,
      )}
    >
      <Info className="size-3.5" aria-hidden />
      {t('explore.verification.unverified')}
    </span>
  )
}

export function SectionHeading({
  title,
  kicker,
  action,
  className,
}: {
  title: string
  kicker?: string
  action?: { href: string; label: string }
  className?: string
}) {
  return (
    <div className={cn('mb-8 flex items-end justify-between gap-6 md:mb-10', className)}>
      <div className="max-w-2xl">
        <h2 className="text-ink text-3xl leading-[1.1] tracking-tight md:text-[42px]">{title}</h2>
        {kicker ? <p className="text-muted mt-3 text-[15px] leading-relaxed">{kicker}</p> : null}
      </div>
      {action ? (
        <Link
          href={action.href}
          className="text-ink border-gold hover:text-gold-deep hidden items-center gap-2 border-b pb-1 text-sm whitespace-nowrap transition-colors duration-150 sm:inline-flex"
        >
          {action.label} <ArrowRight className="size-4" aria-hidden />
        </Link>
      ) : null}
    </div>
  )
}

/** A full-width band in the heavier paper tone, used to break up the page. */
export function Band({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('bg-paper mt-20 md:mt-28', className)}>{children}</section>
}

export function Shell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto max-w-7xl px-5 md:px-8', className)}>{children}</div>
}

/**
 * The surface's own empty state.
 *
 * Separate from `@/components/ui/states` because that one is styled for the
 * product surfaces. Both exist for the same reason: a blank panel cannot tell
 * a reader "nothing matches" from "this is broken".
 */
export function EditorialEmptyState({
  title,
  text,
  action,
}: {
  title: string
  text?: string
  action?: ReactNode
}) {
  return (
    <div className="border-line rounded-2xl border border-dashed py-16 text-center">
      <p className="text-ink text-2xl">{title}</p>
      {text ? <p className="text-muted mx-auto mt-2 max-w-md text-sm">{text}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}

/**
 * The note that has to sit next to any price on this surface.
 *
 * A published rate is a fact about a price list. It is not an offer on a date,
 * and the public surface has no availability lookup behind it, so a figure here
 * must never read as a quote.
 */
export function IllustrativeNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('text-muted flex items-start gap-2 text-xs leading-relaxed', className)}>
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}
