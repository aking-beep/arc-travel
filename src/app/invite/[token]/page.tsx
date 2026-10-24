import { KeyRound } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DemoBanner } from '@/components/demo-banner'
import { EmptyState } from '@/components/ui/states'
import { isAppError } from '@/lib/errors'
import { getInvitation, type InvitationView } from '@/modules/auth/invitations'
import { AcceptInvitationForm } from './form'

export const metadata = {
  title: 'Accept your invitation · ARC Stay',
  // An invitation link must not be indexed or previewed.
  robots: { index: false, follow: false },
}

/**
 * Invitation acceptance.
 *
 * `invitePartner` creates the partner's account but never a password for it.
 * This is where the person it belongs to takes it over, which is the step that
 * turned "the owner can invite a partner" into "the partner can sign in".
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  let invitation: InvitationView
  try {
    invitation = await getInvitation(token)
  } catch (error) {
    // The holder of the link is the person it was sent to, so the reason is
    // help rather than disclosure.
    const message = isAppError(error)
      ? error.message
      : 'This invitation link is not valid.'

    return (
      <div className="flex min-h-dvh flex-col">
        <DemoBanner />
        <main className="mx-auto w-full max-w-lg flex-1 px-5 py-10">
          <EmptyState
            title="This link cannot be used"
            description={`${message} Ask whoever invited you to send a new one.`}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <main className="mx-auto w-full max-w-lg flex-1 px-5 py-10">
        <div className="flex items-center gap-2">
          <KeyRound className="text-jade-700 size-5" aria-hidden />
          <h1 className="font-display text-2xl font-semibold">Set your password</h1>
        </div>
        <p className="text-sand-600 mt-2 max-w-prose text-sm leading-relaxed">
          {invitation.organizationName
            ? `${invitation.organizationName} has set up a partner account for you on ARC Stay.`
            : 'An account has been set up for you on ARC Stay.'}{' '}
          Choose a password and it is yours — nobody at the hotel or at ARC can see it.
        </p>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="text-base">
              {invitation.alreadyUsable ? 'This account already has a password' : 'Your account'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {invitation.alreadyUsable ? (
              <p className="text-sand-700 text-sm leading-relaxed">
                Setting a new one here will replace it.
              </p>
            ) : null}
            <AcceptInvitationForm
              token={token}
              email={invitation.email}
              name={invitation.name}
            />
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
