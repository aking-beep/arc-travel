import { Badge } from '@/components/ui/badge'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/cn'

/**
 * Money display.
 *
 * Two deliberate choices. First, every figure in a demo build renders with a
 * marker so no screenshot can be mistaken for real trading data. Second,
 * `intent` distinguishes money that has actually been earned from money that
 * might be — the owner surface must never add those together, because the
 * single number the pilot is judged on is the earned one.
 */
export function Money({
  amountMinor,
  currency = 'MXN',
  locale,
  intent = 'neutral',
  className,
}: {
  amountMinor: number
  currency?: string
  locale?: string
  intent?: 'earned' | 'potential' | 'neutral'
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
