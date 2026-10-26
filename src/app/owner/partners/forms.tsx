'use client'

import { useActionState } from 'react'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { invitePartnerAction } from '@/app/owner/property/actions'
import { acceptJoinRequestAction, declineJoinRequestAction } from './actions'

const CATEGORIES = ['SURF', 'WELLNESS', 'ADVENTURE', 'DINING', 'TRANSPORT', 'CULTURE'] as const

export function PartnerInviteForm({ places }: { places: Array<{ id: string; name: string }> }) {
  const [state, formAction] = useActionState(invitePartnerAction, emptyFormState)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business name" htmlFor="p-name" error={errors.name}>
          <Input id="p-name" name="name" required placeholder="Escuela Olas Verdes" />
        </Field>
        <Field label="Contact person" htmlFor="p-contact" error={errors.contactName}>
          <Input id="p-contact" name="contactName" required />
        </Field>
        <Field label="Contact email" htmlFor="p-email" error={errors.contactEmail}>
          <Input id="p-email" name="contactEmail" type="email" required />
        </Field>
        <Field label="Contact phone" htmlFor="p-phone">
          <Input id="p-phone" name="contactPhone" />
        </Field>
        <Field label="Based at" htmlFor="p-place">
          <Select id="p-place" name="placeId">
            <option value="">Not set</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Your commission (%)"
          htmlFor="p-commission"
          hint="Your share of gross on their experiences. ARC takes 5% on top."
          error={errors.hotelCommissionBps}
        >
          <Input
            id="p-commission"
            name="hotelCommissionPct"
            type="number"
            min={0}
            max={50}
            step="0.5"
            required
            defaultValue={15}
          />
        </Field>
        <Field
          label="Write to them in"
          htmlFor="p-locale"
          hint="The invitation is the first thing ARC sends them, and the only thing between them and an account."
        >
          <Select id="p-locale" name="contactLocale" defaultValue="ES">
            <option value="ES">Español</option>
            <option value="EN">English</option>
          </Select>
        </Field>
        <Field label="What they do" htmlFor="p-desc" className="sm:col-span-2">
          <Textarea id="p-desc" name="description" rows={3} maxLength={600} />
        </Field>
      </div>

      <fieldset>
        <legend className="text-sand-800 text-sm font-medium">Categories</legend>
        {errors.categories ? (
          <p className="mt-1 text-xs font-medium text-red-700">{errors.categories}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-3">
          {CATEGORIES.map((c) => (
            <label key={c} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="categories" value={c} className="accent-jade-800 size-4" />
              {c}
            </label>
          ))}
        </div>
      </fieldset>

      <SubmitButton>Add partner</SubmitButton>
      <p className="text-sand-500 text-xs">
        Adds the partner and the agreement. No email is sent — outbound messaging is off in this
        build, and verification is a separate ARC check.
      </p>
    </form>
  )
}

/**
 * Deciding on one join request.
 *
 * Accept and decline are two forms rather than one with a choice, because the
 * accept takes a commission and the decline does not, and a single form would
 * have a commission field that is sometimes meaningless. The note on each is
 * the owner's own record; nothing written here is sent to the business.
 */
export function JoinDecisionForms({ requestId }: { requestId: string }) {
  const [acceptState, acceptAction] = useActionState(acceptJoinRequestAction, emptyFormState)
  const [declineState, declineAction] = useActionState(declineJoinRequestAction, emptyFormState)
  const errors = acceptState.fieldErrors ?? {}

  return (
    <div className="space-y-4">
      <FormFeedback state={acceptState} />
      <FormFeedback state={declineState} />

      <form action={acceptAction} className="border-sand-200 space-y-3 rounded-xl border p-4">
        <input type="hidden" name="requestId" value={requestId} />
        <p className="text-sand-800 text-sm font-medium">Take them on</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Your commission (%)"
            htmlFor={`accept-pct-${requestId}`}
            hint="Your share of gross on their experiences. They did not propose one."
            error={errors.hotelCommissionBps}
          >
            <Input
              id={`accept-pct-${requestId}`}
              name="hotelCommissionPct"
              type="number"
              min={0}
              max={50}
              step="0.5"
              required
              defaultValue={15}
            />
          </Field>
          <Field label="Note to yourself" htmlFor={`accept-note-${requestId}`}>
            <Input id={`accept-note-${requestId}`} name="decisionNote" />
          </Field>
        </div>
        <SubmitButton size="sm">Accept and invite them</SubmitButton>
      </form>

      <form action={declineAction} className="border-sand-200 space-y-3 rounded-xl border p-4">
        <input type="hidden" name="requestId" value={requestId} />
        <p className="text-sand-800 text-sm font-medium">Not for now</p>
        <Field
          label="Why, for your own record"
          htmlFor={`decline-note-${requestId}`}
          hint="Nothing is sent to them. ARC does not write to a business in your name."
        >
          <Input id={`decline-note-${requestId}`} name="decisionNote" />
        </Field>
        <SubmitButton size="sm" variant="outline">
          Decline
        </SubmitButton>
      </form>
    </div>
  )
}
