'use client'

import { useActionState } from 'react'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { requestToJoinAction } from './actions'

const CATEGORIES = ['SURF', 'WELLNESS', 'ADVENTURE', 'DINING', 'TRANSPORT', 'CULTURE'] as const

/**
 * The cold route in.
 *
 * It asks for no password, because it creates no account: the hotel accepting
 * is what creates the account, through the same invitation handover an owner
 * uses from their partners page. So there is nothing here a stranger can use
 * to put their business in a real hotel's partner list.
 */
export function JoinRequestForm({
  storefronts,
}: {
  storefronts: Array<{ slug: string; name: string; placeName: string | null }>
}) {
  const [state, formAction] = useActionState(requestToJoinAction, emptyFormState)
  const errors = state.fieldErrors ?? {}

  // Sent: the form is replaced, because leaving it filled in invites a second
  // send and the honest answer to a second send is the same as the first.
  if (state.ok) return <FormFeedback state={state} />

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />

      <Field label="Which hotel" htmlFor="propertySlug" error={errors.propertySlug}>
        <Select id="propertySlug" name="propertySlug" required>
          <option value="">Choose…</option>
          {storefronts.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.placeName ? `${s.name} — ${s.placeName}` : s.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Your business" htmlFor="businessName" error={errors.businessName}>
        <Input id="businessName" name="businessName" required />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your name" htmlFor="contactName" error={errors.contactName}>
          <Input id="contactName" name="contactName" required />
        </Field>
        <Field label="Email" htmlFor="contactEmail" error={errors.contactEmail}>
          <Input id="contactEmail" name="contactEmail" type="email" required />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phone or WhatsApp" htmlFor="contactPhone" error={errors.contactPhone}>
          <Input id="contactPhone" name="contactPhone" />
        </Field>
        <Field
          label="Language you prefer"
          htmlFor="locale"
          hint="Which language the hotel’s invitation should be written in."
          error={errors.locale}
        >
          <Select id="locale" name="locale" defaultValue="ES">
            <option value="ES">Español</option>
            <option value="EN">English</option>
          </Select>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sand-800 text-sm font-medium">What you run</legend>
        {errors.categories ? (
          <p className="text-sm text-red-700">{errors.categories}</p>
        ) : (
          <p className="text-sand-500 text-sm">Pick everything that applies.</p>
        )}
        <div className="mt-1 flex flex-wrap gap-3">
          {CATEGORIES.map((c) => (
            <label key={c} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="categories"
                value={c}
                className="border-sand-300 text-jade-700 size-4 rounded"
              />
              {c.charAt(0) + c.slice(1).toLowerCase()}
            </label>
          ))}
        </div>
      </fieldset>

      <Field
        label="What you would offer their guests"
        htmlFor="pitch"
        hint="A few sentences. What you run, how long you have run it, how many people you can take."
        error={errors.pitch}
      >
        <Textarea id="pitch" name="pitch" rows={5} />
      </Field>

      <Field
        label="Certifications you hold"
        htmlFor="claimedCertifications"
        hint="One per line. These stay your claims until ARC has seen the certificates."
        error={errors.claimedCertifications}
      >
        <Textarea id="claimedCertifications" name="claimedCertifications" rows={3} />
      </Field>

      <SubmitButton>Send it to the hotel</SubmitButton>
    </form>
  )
}
