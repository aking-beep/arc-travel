import Link from 'next/link'
import { Store } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { DemoBanner } from '@/components/demo-banner'
import { listOpenStorefronts } from '@/modules/suppliers/self-service'
import { JoinRequestForm } from './form'

export const metadata = {
  title: 'Work with a hotel · ARC Stay',
  description: 'Ask a hotel on ARC Stay to offer your experiences to their guests.',
}

/**
 * The route in for a business nobody has invited.
 *
 * Until this existed, a local operator could only reach ARC Stay if a hotel
 * already knew about them and typed their email in — which is fine for the
 * three partners a hotel already works with and useless for the fourth.
 *
 * What it does *not* do is the point: no account, no supplier record, no
 * agreement, no verification. It writes a row the hotel can read, and the
 * hotel accepting is what creates the relationship.
 */
export default async function PartnerJoinPage() {
  const storefronts = await listOpenStorefronts()

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10">
        <div className="flex items-center gap-2">
          <Store className="text-jade-700 size-5" aria-hidden />
          <h1 className="font-display text-2xl font-semibold">Work with a hotel</h1>
        </div>
        <p className="text-sand-600 mt-2 max-w-prose text-sm leading-relaxed">
          If you run surf lessons, a kitchen, a boat, a studio or a car, you can ask a hotel on ARC
          Stay to offer it to their guests. They decide, and they set the terms. If they say yes,
          they will send you an invitation by email — that is what creates your account, and it is
          the only thing that does.
        </p>

        {storefronts.length === 0 ? (
          <EmptyState
            className="mt-8"
            icon={<Store className="size-6" aria-hidden />}
            title="No hotels are taking partners here yet"
            description="Nothing to send a request to for now. Come back once a hotel in your town is on ARC Stay."
          />
        ) : (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="text-base">About you</CardTitle>
            </CardHeader>
            <CardContent>
              <JoinRequestForm storefronts={storefronts} />
            </CardContent>
          </Card>
        )}

        <p className="text-sand-600 mt-6 text-sm">
          Already working with a hotel and have an invitation?{' '}
          <Link href="/sign-in" className="text-jade-800 underline underline-offset-4">
            Sign in
          </Link>
          .
        </p>
      </main>
    </div>
  )
}
