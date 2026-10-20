import { ZodError } from 'zod'
import { isAppError } from '@/lib/errors'

/**
 * The shape every server action returns to a form.
 *
 * Lives outside the `'use server'` modules because a server-action file may
 * only export async functions — a plain constant in one breaks the build.
 */
export interface FormState {
  ok: boolean
  message?: string
  /** Field-level messages keyed by input name. */
  fieldErrors?: Record<string, string>
  /** Non-blocking notes, e.g. an ability range that had to be narrowed. */
  notes?: string[]
}

export const emptyFormState: FormState = { ok: false }

export function zodFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

/**
 * Converts a thrown error into a `FormState`. Anything that is not a validation
 * failure or a known domain error is re-thrown, so genuine bugs still surface
 * as errors instead of being swallowed into a form message.
 */
export function toFormState(error: unknown): FormState {
  if (error instanceof ZodError) {
    return {
      ok: false,
      message: 'Check the highlighted fields.',
      fieldErrors: zodFieldErrors(error),
    }
  }
  if (isAppError(error)) {
    const details = error.details as { blockers?: string[] } | undefined
    return { ok: false, message: error.message, notes: details?.blockers }
  }
  throw error
}

/** Pesos in a form, centavos in the domain. Converted exactly once, at the edge. */
export function pesosToMinor(value: FormDataEntryValue | null): number {
  const parsed = Number(String(value ?? '0').replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(parsed)) return 0
  return Math.round(parsed * 100)
}
