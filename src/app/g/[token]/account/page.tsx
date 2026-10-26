import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { resolvePortalForRequest } from '../resolve'
import { PortalAccountForm } from './form'

export const metadata = { title: 'Create your account' }

/**
 * Sign up from inside the portal.
 *
 * Renders under the portal layout, so the person stays in their hotel's
 * surface while they do it. Already-claimed stays bounce to `/me`: an account
 * holder who followed a stale link should land on their bookings, not on a
 * form that would refuse them.
 */
export default async function PortalAccountPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const context = await resolvePortalForRequest(token)

  if (context.hasAccount) redirect('/me')

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-semibold">Create your account</h2>
        <p className="text-sand-600 mt-1 text-sm leading-relaxed">
          So you can come back to {context.property.name} without the QR code, and keep every
          booking in one place.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {context.reference} · {context.checkIn} → {context.checkOut}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PortalAccountForm
            token={token}
            email={context.guestEmail}
            defaultName={`${context.guestFirstName} ${context.guestLastName}`.trim()}
          />
        </CardContent>
      </Card>

      <p className="text-sand-600 text-sm">
        Already have an account?{' '}
        <Link href="/sign-in?next=%2Fme" className="text-jade-800 underline underline-offset-4">
          Sign in
        </Link>
        .
      </p>
    </div>
  )
}
