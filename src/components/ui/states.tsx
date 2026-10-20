import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Loading, empty and error states.
 *
 * Every list and panel in ARC Stay renders one of these rather than collapsing
 * to nothing — an owner looking at a blank panel cannot tell the difference
 * between "no arrivals today" and "this is broken".
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-sand-200/80 animate-pulse rounded-lg', className)} />
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'border-sand-300 flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? <div className="text-sand-400">{icon}</div> : null}
      <p className="text-sand-800 font-medium">{title}</p>
      {description ? <p className="text-sand-600 max-w-prose text-sm">{description}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  )
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  action,
  className,
}: {
  title?: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-5 py-4',
        className,
      )}
      role="alert"
    >
      <p className="font-medium text-red-900">{title}</p>
      {description ? <p className="text-sm text-red-800">{description}</p> : null}
      {action}
    </div>
  )
}
