'use client'

import { useFormStatus } from 'react-dom'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import type { FormState } from '@/lib/form-state'

/**
 * Submit button that disables itself and announces progress while the server
 * action runs, so a double-tap on a phone cannot create two experiences.
 */
export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} {...props}>
      {pending ? (pendingLabel ?? 'Saving…') : children}
    </Button>
  )
}

/** Renders a server action's result: one message plus any advisory notes. */
export function FormFeedback({ state, className }: { state: FormState; className?: string }) {
  if (!state.message && !state.notes?.length) return null

  const tone = state.ok
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : 'border-red-200 bg-red-50 text-red-900'

  return (
    <div
      className={cn('rounded-xl border px-4 py-3 text-sm', tone, className)}
      role={state.ok ? 'status' : 'alert'}
    >
      {state.message ? (
        <p className="flex items-start gap-2 font-medium">
          {state.ok ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : (
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          {state.message}
        </p>
      ) : null}
      {state.notes?.length ? (
        <ul className="mt-2 space-y-1 pl-6">
          {state.notes.map((note) => (
            <li key={note} className="flex items-start gap-2">
              <Info className="mt-0.5 size-3.5 shrink-0 opacity-70" aria-hidden />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
