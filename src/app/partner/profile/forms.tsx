'use client'

import { useActionState } from 'react'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { submitEvidenceAction, updateOwnProfileAction } from '../actions'

const CATEGORIES = ['SURF', 'WELLNESS', 'ADVENTURE', 'DINING', 'TRANSPORT', 'CULTURE'] as const

/**
 * What the partner says about themselves.
 *
 * Nothing here can touch their verification: the form has no field for it, the
 * schema is `.strict()` and could not name one, and the hotel's view of this
 * business is rendered from the same columns — so a partner editing their own
 * description is editing the copy a guest reads, which is the point.
 */
export function ProfileForm({
  profile,
  places,
}: {
  profile: {
    name: string
    legalName: string | null
    description: string | null
    categories: string[]
    contactEmail: string
    contactPhone: string | null
    placeId: string | null
  }
  places: Array<{ id: string; name: string }>
}) {
  const [state, formAction] = useActionState(updateOwnProfileAction, emptyFormState)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />

      <Field label="Business name" htmlFor="name" error={errors.name}>
        <Input id="name" name="name" required defaultValue={profile.name} />
      </Field>

      <Field
        label="Registered name"
        htmlFor="legalName"
        hint="If your invoices are in a different name to the one guests see."
        error={errors.legalName}
      >
        <Input id="legalName" name="legalName" defaultValue={profile.legalName ?? ''} />
      </Field>

      <Field
        label="What you do"
        htmlFor="description"
        hint="A guest reads this before they book. Say what the experience is actually like."
        error={errors.description}
      >
        <Textarea
          id="description"
          name="description"
          rows={5}
          defaultValue={profile.description ?? ''}
        />
      </Field>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sand-800 text-sm font-medium">What you offer</legend>
        {errors.categories ? (
          <p className="text-sm text-red-700">{errors.categories}</p>
        ) : (
          <p className="text-sand-500 text-sm">Pick every kind of thing you run.</p>
        )}
        <div className="mt-1 flex flex-wrap gap-3">
          {CATEGORIES.map((c) => (
            <label key={c} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="categories"
                value={c}
                defaultChecked={profile.categories.includes(c)}
                className="border-sand-300 text-jade-700 size-4 rounded"
              />
              {c.charAt(0) + c.slice(1).toLowerCase()}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Contact email" htmlFor="contactEmail" error={errors.contactEmail}>
          <Input
            id="contactEmail"
            name="contactEmail"
            type="email"
            required
            defaultValue={profile.contactEmail}
          />
        </Field>
        <Field label="Phone" htmlFor="contactPhone" error={errors.contactPhone}>
          <Input id="contactPhone" name="contactPhone" defaultValue={profile.contactPhone ?? ''} />
        </Field>
      </div>

      <Field
        label="Where you are based"
        htmlFor="placeId"
        hint="Optional, and not the same as where a given experience meets."
        error={errors.placeId}
      >
        <Select id="placeId" name="placeId" defaultValue={profile.placeId ?? ''}>
          <option value="">Not saying</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>

      <SubmitButton>Save</SubmitButton>
    </form>
  )
}

/**
 * Evidence, which is a request for a check and not a check.
 *
 * Every label on this form says "claimed" or "you say", because that is what
 * these columns hold. Submitting moves the partner to `PENDING` — somebody has
 * asked us to look — and `/admin` remains the only route to `VERIFIED`.
 */
export function EvidenceForm({
  evidence,
}: {
  evidence: {
    claimedCertifications: string[]
    claimedInsurer: string | null
    claimedInsurancePolicyRef: string | null
    claimedInsuranceExpiresOn: string | null
    evidenceNotes: string | null
  }
}) {
  const [state, formAction] = useActionState(submitEvidenceAction, emptyFormState)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />

      <Field
        label="Certifications you hold"
        htmlFor="claimedCertifications"
        hint="One per line. These are shown to guests as your claims until ARC has seen the certificate."
        error={errors.claimedCertifications}
      >
        <Textarea
          id="claimedCertifications"
          name="claimedCertifications"
          rows={4}
          defaultValue={evidence.claimedCertifications.join('\n')}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Insurer" htmlFor="claimedInsurer" error={errors.claimedInsurer}>
          <Input
            id="claimedInsurer"
            name="claimedInsurer"
            defaultValue={evidence.claimedInsurer ?? ''}
          />
        </Field>
        <Field
          label="Policy number"
          htmlFor="claimedInsurancePolicyRef"
          error={errors.claimedInsurancePolicyRef}
        >
          <Input
            id="claimedInsurancePolicyRef"
            name="claimedInsurancePolicyRef"
            defaultValue={evidence.claimedInsurancePolicyRef ?? ''}
          />
        </Field>
      </div>

      <Field
        label="Policy expires"
        htmlFor="claimedInsuranceExpiresOn"
        hint="ARC will ask you for the renewal before this date. A verification lapses when the cover does."
        error={errors.claimedInsuranceExpiresOn}
      >
        <Input
          id="claimedInsuranceExpiresOn"
          name="claimedInsuranceExpiresOn"
          type="date"
          defaultValue={evidence.claimedInsuranceExpiresOn ?? ''}
        />
      </Field>

      <Field
        label="Anything else ARC should know"
        htmlFor="evidenceNotes"
        hint="How to reach the certifying body, where the certificates are, who to speak to."
        error={errors.evidenceNotes}
      >
        <Textarea
          id="evidenceNotes"
          name="evidenceNotes"
          rows={4}
          defaultValue={evidence.evidenceNotes ?? ''}
        />
      </Field>

      <SubmitButton>Send to ARC for checking</SubmitButton>
    </form>
  )
}
