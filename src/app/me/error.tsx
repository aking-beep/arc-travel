'use client'

import { ErrorState } from '@/components/ui/states'
import { Button } from '@/components/ui/button'

/**
 * The account's error state.
 *
 * Says explicitly that nothing was lost, because the alternative reading of a
 * failed load on this page — that the bookings are gone — is the frightening
 * one and the wrong one.
 */
export default function AccountError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <ErrorState
        title="We could not load your bookings"
        description="Nothing has been lost. Try again in a moment."
        action={
          <Button type="button" variant="outline" size="sm" onClick={reset}>
            Try again
          </Button>
        }
      />
    </div>
  )
}
