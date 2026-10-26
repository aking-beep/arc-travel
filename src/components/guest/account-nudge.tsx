import Link from 'next/link'
import { UserPlus } from 'lucide-react'
import type { Translator } from '@/lib/i18n'

/**
 * Offers the guest an account, from inside the portal they are already in.
 *
 * This is the honest place for the offer. The person is holding the QR code,
 * so they have already proved the booking — which is why the form it leads to
 * asks for a name and a password and nothing else, rather than making them
 * find a reference they have already used. Nothing about the portal changes if
 * they ignore it.
 *
 * Hidden once the guest record is claimed: an account holder who arrived from
 * their own QR code does not need to be asked again. The portal knows only
 * *whether* the record is claimed, never by whom.
 */
export function AccountNudge({
  token,
  hasAccount,
  t,
}: {
  token: string
  hasAccount: boolean
  t: Translator
}) {
  if (hasAccount) return null

  return (
    <div className="border-sand-300 rounded-xl border border-dashed px-4 py-3">
      <p className="flex items-start gap-2 text-sm">
        <UserPlus className="text-jade-700 mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="text-sand-700">
          {t('guest.accountOffer')}{' '}
          <Link
            href={`/g/${token}/account`}
            className="text-jade-800 font-medium underline underline-offset-4"
          >
            {t('guest.accountOfferLink')}
          </Link>
        </span>
      </p>
    </div>
  )
}
