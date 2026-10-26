'use server'

import { headers } from 'next/headers'
import { toFormState, type FormState } from '@/lib/form-state'
import { requestToJoinProperty } from '@/modules/suppliers/self-service'

/**
 * A business asking a hotel to take them on.
 *
 * Unauthenticated, so the caller's address is read here — only the app layer
 * may touch headers — and handed to the service, which bounds requests per
 * caller and per hotel.
 */
function clientKey(headerList: Headers): string | null {
  const forwarded = headerList.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || headerList.get('x-real-ip') || null
}

export async function requestToJoinAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const outcome = await requestToJoinProperty(
      {
        propertySlug: String(formData.get('propertySlug') ?? ''),
        businessName: String(formData.get('businessName') ?? ''),
        contactName: String(formData.get('contactName') ?? ''),
        contactEmail: String(formData.get('contactEmail') ?? ''),
        contactPhone: String(formData.get('contactPhone') ?? '') || null,
        categories: formData.getAll('categories').map((v) => String(v)),
        pitch: String(formData.get('pitch') ?? '') || null,
        claimedCertifications: String(formData.get('claimedCertifications') ?? '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        locale: String(formData.get('locale') ?? 'ES') === 'EN' ? 'EN' : 'ES',
      },
      { requesterKey: clientKey(await headers()) },
    )

    return {
      ok: true,
      message: `Sent to ${outcome.propertyName}. If they want to work with you they will invite you by email, and that invitation is what creates your account.`,
      notes: [
        'Nothing has been published and nothing has been agreed. ARC has not checked anything you have told us here.',
      ],
    }
  } catch (error) {
    return toFormState(error)
  }
}
