'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { toFormState, type FormState } from '@/lib/form-state'
import { registerOrganization } from '@/modules/onboarding/service'
import { signInAs } from '@/modules/auth/service'

function clientKey(headerList: Headers): string | null {
  const forwarded = headerList.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || headerList.get('x-real-ip') || null
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const registered = await registerOrganization(
      {
        name: String(formData.get('name') ?? ''),
        email: String(formData.get('email') ?? ''),
        password: String(formData.get('password') ?? ''),
        confirmPassword: String(formData.get('confirmPassword') ?? ''),
        organizationName: String(formData.get('organizationName') ?? ''),
        legalName: String(formData.get('legalName') ?? '') || undefined,
        countryCode: String(formData.get('countryCode') ?? 'MX'),
        propertyName: String(formData.get('propertyName') ?? ''),
        propertyTagline: String(formData.get('propertyTagline') ?? '') || undefined,
        currency: String(formData.get('currency') ?? 'MXN'),
        contactPhone: String(formData.get('contactPhone') ?? '') || undefined,
        acceptedTerms: formData.get('acceptedTerms') === 'on',
      },
      { clientKey: clientKey(await headers()) },
    )
    // The service deliberately does not touch cookies; establishing the
    // session is this layer's job.
    await signInAs(registered.userId)
  } catch (error) {
    return toFormState(error)
  }

  // Straight to the dashboard, which is where the remaining onboarding steps
  // are listed. `redirect` throws, so it cannot sit inside the try above.
  redirect('/owner')
}
