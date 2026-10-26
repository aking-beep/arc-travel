import Link from 'next/link'
import { MapPinned } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { DemoBanner } from '@/components/demo-banner'
import { addDays, toDateKey } from '@/lib/dates'
import { listDirectStorefronts, MAX_DIRECT_TRIP_DAYS } from '@/modules/guest/direct'
import { DirectSignUpForm } from './form'

export const metadata = {
  title: 'Plan a trip · ARC Stay',
  description:
    'Book experiences in Puerto Escondido without booking a room, through a hotel that curates them.',
}

/**
 * The route in for somebody who is not staying anywhere.
 *
 * Every other way into the guest surface starts at a front desk, which meant
 * ARC Stay could not sell anything to a resident, a day visitor, or somebody
 * in an apartment — most of the people in the town on any given day.
 *
 * It reserves no room and says so three times, because a form with dates and a
 * hotel's name on it reads as a reservation. See ADR-042.
 */
export default async function DirectSignUpPage() {
  const storefronts = await listDirectStorefronts()

  // Server-computed, because a client component must not read the clock.
  const today = toDateKey(new Date())

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10">
        <div className="flex items-center gap-2">
          <MapPinned className="text-jade-700 size-5" aria-hidden />
          <h1 className="font-display text-2xl font-semibold">Plan a trip</h1>
        </div>
        <p className="text-sand-600 mt-2 max-w-prose text-sm leading-relaxed">
          For anyone who wants to book things to do here and is not booking a room — you live
          here, you are in for the day, or you are staying somewhere else. Tell us when you are
          around and who you are with, and you get the same planner a hotel’s guests get.
        </p>
        <p className="text-sand-500 mt-2 max-w-prose text-sm leading-relaxed">
          <strong className="font-medium">This books no accommodation.</strong> You are choosing a
          hotel’s storefront, not a room: they curate what is on offer and stand behind the
          operators who run it. Up to {MAX_DIRECT_TRIP_DAYS} days at a time.
        </p>

        {storefronts.length === 0 ? (
          <EmptyState
            className="mt-8"
            icon={<MapPinned className="size-6" aria-hidden />}
            title="Nothing open to book through yet"
            description="No hotel here is taking direct bookings at the moment. Come back once one is."
          />
        ) : (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="text-base">Your trip</CardTitle>
            </CardHeader>
            <CardContent>
              <DirectSignUpForm
                storefronts={storefronts}
                defaultFromDate={today}
                defaultToDate={addDays(today, 2)}
              />
            </CardContent>
          </Card>
        )}

        <p className="text-sand-600 mt-6 text-sm">
          Already have an account?{' '}
          <Link href="/sign-in" className="text-jade-800 underline underline-offset-4">
            Sign in
          </Link>{' '}
          and add a trip from there.
        </p>
        <p className="text-sand-600 mt-2 text-sm">
          Staying at a hotel on ARC Stay?{' '}
          <Link href="/sign-up/guest" className="text-jade-800 underline underline-offset-4">
            Use your booking reference
          </Link>{' '}
          instead — that links your room and your plan.
        </p>
      </main>
    </div>
  )
}
