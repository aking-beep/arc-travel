import { Skeleton } from '@/components/ui/states'

/**
 * The account's loading state.
 *
 * `/me` reads a person's stays, plan, orders and basket in one query, so it is
 * the slowest guest surface there is. A blank page while that runs cannot tell
 * somebody "you have no bookings" from "this is broken", which is the
 * distinction `CLAUDE.md` asks every panel to make.
 */
export default function AccountLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-5 py-8" aria-busy>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-48 w-full rounded-2xl" />
      <Skeleton className="h-48 w-full rounded-2xl" />
      <span className="sr-only">Loading your bookings…</span>
    </div>
  )
}
