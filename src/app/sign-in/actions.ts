'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { safeNext } from '@/lib/demo-gate'
import { toFormState, type FormState } from '@/lib/form-state'
import { signInWithPassword } from '@/modules/auth/credentials'
import { Role } from '@/lib/prisma-types'
import { hasGuestRecords } from '@/modules/guest/account'
import type { ActorContext } from '@/modules/tenancy/context'

/**
 * Password sign-in.
 *
 * The caller's address comes from the request headers here, because only the
 * app layer may read them, and the service needs it to bound guessing per
 * caller as well as per account.
 */
function clientKey(headerList: Headers): string | null {
  const forwarded = headerList.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || headerList.get('x-real-ip') || null
}

/**
 * Where a person lands when they did not ask for a particular page.
 *
 * Membership roles are checked before guest records, because they are the
 * stronger claim: an owner who also stayed at somebody else's hotel wants
 * their dashboard. The guest check is last and costs a query, so it only runs
 * for an account with no membership at all.
 */
export async function landingFor(actor: ActorContext): Promise<string> {
  if (actor.isPlatformAdmin) return '/admin'
  const roles = new Set(actor.memberships.map((m) => m.role))
  if (roles.has(Role.OWNER)) return '/owner'
  if (roles.has(Role.STAFF)) return '/owner/arrivals'
  if (roles.has(Role.SUPPLIER)) return '/partner'
  if (await hasGuestRecords(actor.userId)) return '/me'
  return '/'
}

export async function passwordSignInAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const requested = safeNext(String(formData.get('next') ?? '/'))

  let target: string
  try {
    const actor = await signInWithPassword(
      {
        email: String(formData.get('email') ?? ''),
        password: String(formData.get('password') ?? ''),
      },
      { clientKey: clientKey(await headers()) },
    )
    target = requested !== '/' ? requested : await landingFor(actor)
  } catch (error) {
    return toFormState(error)
  }

  // Outside the try: `redirect` works by throwing, so catching it here would
  // turn a successful sign-in into a form error.
  redirect(target)
}
