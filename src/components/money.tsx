import { Badge } from '@/components/ui/badge'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/cn'

/**
 * Money display.
 *
 * `intent` distinguishes money that has actually been earned from money that
 * might be. The owner surface must never add those together, because the single
 * number the pilot is judged on is the earned one (ADR-007).
 *
 * This component does **not** carry the demo marker, and the comment here used
 * to claim it did. What is actually true, stated precisely so the claim is
 * checkable:
 *
 *   * Every surface renders `DemoBanner`, so no page of figures is unmarked.
 *   * Every headline figure — the one a screenshot would be *of* — is wrapped
 *     in `DemoFigure`, which puts the badge next to the number itself.
 *   * A figure inside a table or a list is not individually badged. Thirty
 *     badges down a column is noise that stops being read, which is a worse
 *     outcome than one badge on the total above it.
 *
 * `Money` cannot decide this for itself: `isDemoMode()` reads the environment
 * and half the callers are client components, so demo-ness would have to be
 * threaded through every one of them as a prop. The marker is therefore the
 * caller's to place, and the rule above is where to place it.
 *
 * `intent` is **required**, and used to have a `neutral` default. Thirty-nine
 * of eighty-one call sites took that default — eight of them on
 * `/owner/revenue`, the one page where ADR-007's distinction between money
 * earned and money that might be is the whole point. A default that is right
 * on a line item and wrong on a revenue total is a rule enforced by whoever
 * remembers it. `neutral` is still available; it now has to be chosen.
 */
export function Money({
  amountMinor,
  currency = 'MXN',
  locale,
  intent,
  className,
}: {
  amountMinor: number
  currency?: string
  locale?: string
  intent: 'earned' | 'potential' | 'neutral'
  className?: string
}) {
  return (
    <span
      className={cn(
        'tabular-nums',
        intent === 'potential' && 'text-sand-600',
        intent === 'earned' && 'text-jade-900',
        className,
      )}
    >
      {formatMoney(amountMinor, currency, locale)}
    </span>
  )
}

export function DemoFigure({ children, label = 'Demo' }: { children: React.ReactNode; label?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      {children}
      <Badge tone="demo" className="translate-y-px">
        {label}
      </Badge>
    </span>
  )
}
