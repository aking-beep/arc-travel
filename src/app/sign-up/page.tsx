import Link from 'next/link'
import { Building2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DemoBanner } from '@/components/demo-banner'
import { SignUpForm } from './form'

export const metadata = {
  title: 'Register your hotel · ARC Stay',
  description: 'Create an ARC Stay account for an independent boutique hotel.',
}

/**
 * Step one of the commercial journey.
 *
 * Before this page existed nothing in the product created an `Organization` or
 * a `Property` — only the seed did — so the honest answer to "can a hotel sign
 * up?" was no. Everything it creates starts as a draft, and nothing it creates
 * is verified: `/admin` remains the only route to a verified status.
 */
export default function SignUpPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10">
        <div className="flex items-center gap-2">
          <Building2 className="text-jade-700 size-5" aria-hidden />
          <h1 className="font-display text-2xl font-semibold">Register your hotel</h1>
        </div>
        <p className="text-sand-600 mt-2 max-w-prose text-sm leading-relaxed">
          This creates your account, your business and your first property. You will land on your
          dashboard with the remaining steps listed: rooms, local partners, experiences, and the
          guests you want to give a portal to.
        </p>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="text-base">Your details</CardTitle>
          </CardHeader>
          <CardContent>
            <SignUpForm />
          </CardContent>
        </Card>

        <p className="text-sand-600 mt-6 text-sm">
          Already registered?{' '}
          <Link href="/sign-in" className="text-jade-800 underline underline-offset-4">
            Sign in
          </Link>
        </p>
        <p className="text-sand-600 mt-2 text-sm">
          Staying at a hotel rather than running one?{' '}
          <Link href="/sign-up/guest" className="text-jade-800 underline underline-offset-4">
            Create a guest account
          </Link>{' '}
          instead.
        </p>
        <p className="text-sand-600 mt-2 text-sm">
          Running an experience you would like a hotel to offer?{' '}
          <Link href="/sign-up/partner" className="text-jade-800 underline underline-offset-4">
            Ask a hotel to work with you
          </Link>{' '}
          instead.
        </p>
      </main>
    </div>
  )
}
