import Link from 'next/link'
import { LuggageIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DemoBanner } from '@/components/demo-banner'
import { GuestSignUpForm } from './form'

export const metadata = {
  title: 'Create your guest account · ARC Stay',
  description: 'Claim a booking and see your stay, your plan and anything you have booked.',
}

/**
 * Guest sign-up.
 *
 * A guest's only way in used to be the QR code at the front desk. That token
 * is the right thing to hand over at a desk and the wrong thing to be
 * somebody's only way back to their own booking — it cannot be recovered, and
 * it shows one stay even when the person has three.
 *
 * What this page is careful about: the account is *claimed*, with the booking
 * reference and the address the property recorded, together. Neither alone is
 * enough, and a refusal does not say which of the two was wrong. See ADR-039.
 */
export default async function GuestSignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string }>
}) {
  const { reference } = await searchParams

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10">
        <div className="flex items-center gap-2">
          <LuggageIcon className="text-jade-700 size-5" aria-hidden />
          <h1 className="font-display text-2xl font-semibold">Create your guest account</h1>
        </div>
        <p className="text-sand-600 mt-2 max-w-prose text-sm leading-relaxed">
          One place for your stay, your plan for the days and anything you have booked — without
          having to find the QR code again. You will need the booking reference from your
          confirmation and the email address the property has for you.
        </p>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="text-base">Claim your booking</CardTitle>
          </CardHeader>
          <CardContent>
            <GuestSignUpForm reference={typeof reference === 'string' ? reference : ''} />
          </CardContent>
        </Card>

        <p className="text-sand-600 mt-6 text-sm">
          Already have an account?{' '}
          <Link href="/sign-in" className="text-jade-800 underline underline-offset-4">
            Sign in
          </Link>
          .
        </p>
        <p className="text-sand-600 mt-2 text-sm">
          Running a hotel rather than staying at one?{' '}
          <Link href="/sign-up" className="text-jade-800 underline underline-offset-4">
            Register your hotel
          </Link>
          .
        </p>
      </main>
    </div>
  )
}
