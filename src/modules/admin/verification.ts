import { VerificationStatus } from '@/lib/prisma-types'
import { toDateKey, type DateKey } from '@/lib/dates'

/**
 * What a partner verification consists of, and whether it still holds.
 *
 * ## Why this is not just the `verification` column
 *
 * `verifySupplier` took a free-text note with a ten-character minimum and a
 * boolean called `insuranceOnFile`. That made "VERIFIED" mean "an admin typed
 * at least ten characters", which is a record that something happened rather
 * than a record of what was checked. Non-negotiable 2 says ARC must never
 * invent verification; a claim this thin is not invented, but it is not
 * inspectable either, and a year later nobody can tell whether the tax ID was
 * ever seen.
 *
 * So the checks are enumerated, recorded individually, and all of the required
 * ones must be present. A later reviewer reads the list rather than parsing
 * prose.
 *
 * ## Why verification can lapse
 *
 * `insuranceOnFile` was a boolean, and a boolean cannot expire. Liability
 * insurance does. A partner verified in January with a certificate that ran out
 * in March was still displayed to guests as verified in December, on the
 * strength of a document nobody had seen since.
 *
 * `verificationStanding` therefore derives a *current* answer from the stored
 * decision plus the clock. A lapsed verification is not downgraded in the
 * database — the decision was correctly made on the evidence available — but it
 * is not presented as current either.
 */

export interface VerificationCheck {
  key: string
  /** Shown to the admin doing the check. */
  label: string
  /** What specifically to look at, because "check the insurance" is not a step. */
  detail: string
  /**
   * Required for VERIFIED.
   *
   * Optional checks exist because some of them do not apply to every partner —
   * a one-person surf guide has no company registration — and refusing to
   * verify anyone who lacks one would mean the status stopped being used.
   */
  required: boolean
}

/**
 * The checklist.
 *
 * Ordered as the conversation with a partner actually goes, not by importance:
 * identity, then the right to operate, then the money, then the insurance that
 * matters most and takes longest to obtain.
 */
export const VERIFICATION_CHECKS: readonly VerificationCheck[] = [
  {
    key: 'identity',
    label: 'A named human being',
    detail:
      'Official photo ID of the person who signs for the business, matched against the name on ' +
      'the agreement. Not a business card, not a WhatsApp profile.',
    required: true,
  },
  {
    key: 'legal_entity',
    label: 'Legal entity or sole trader registration',
    detail:
      'Acta constitutiva for a company, or evidence of registration as a persona física con ' +
      'actividad empresarial. Record the legal name on the Supplier record, which is what a ' +
      'payout and any dispute will use.',
    required: false,
  },
  {
    key: 'tax_id',
    label: 'RFC',
    detail:
      'The Mexican tax ID, from the SAT constancia de situación fiscal rather than from the ' +
      'partner telling you. ARC does not issue their invoices, but a partner who cannot invoice ' +
      'cannot be paid for long.',
    required: true,
  },
  {
    key: 'operating_permit',
    label: 'Permission to operate where they say they do',
    detail:
      'For water activities in Puerto Escondido this is the Capitanía de Puerto permit, and for ' +
      'anything inside a protected area the relevant CONANP authorisation. A partner operating ' +
      'without one is a liability ARC would be selling.',
    required: true,
  },
  {
    key: 'guide_certification',
    label: 'Guide certification, where an activity requires one',
    detail:
      'Check against the activities they will actually run: `Activity.guideRequired` is set for ' +
      'the ones that need it. A certification claimed in `claimedCertifications` is a claim ' +
      'until it is checked here.',
    required: false,
  },
  {
    key: 'bank_details',
    label: 'Bank details, confirmed out of band',
    detail:
      'CLABE plus account holder name, confirmed by a call to a number you already had — not by ' +
      'replying to the email that sent them. Payout fraud is a redirected bank detail, almost ' +
      'every time.',
    required: true,
  },
  {
    key: 'insurance',
    label: 'Liability insurance, in force',
    detail:
      'The certificate itself, with the insurer, the policy number, the activities covered and ' +
      'the expiry date. Record the expiry: this is the one piece of evidence that stops being ' +
      'true on a date known in advance.',
    required: true,
  },
] as const

export const REQUIRED_CHECK_KEYS: readonly string[] = VERIFICATION_CHECKS.filter(
  (c) => c.required,
).map((c) => c.key)

export const CHECK_KEYS: readonly string[] = VERIFICATION_CHECKS.map((c) => c.key)

/** The check whose evidence carries an expiry date. */
export const INSURANCE_CHECK_KEY = 'insurance'

export type Standing = 'verified' | 'lapsed' | 'unverified' | 'rejected'

export interface VerificationStanding {
  standing: Standing
  /** One sentence, suitable for showing an admin. Null when simply verified. */
  reason: string | null
  /** Set when the standing is `lapsed` and the cause is an expiry. */
  expiredOn: DateKey | null
  /** Required checks with no record. Empty unless `unverified`. */
  missingChecks: readonly string[]
}

export interface StandingInput {
  verification: VerificationStatus
  verifiedChecks: readonly string[]
  insuranceExpiresOn: Date | null
}

/**
 * The three columns `verificationStanding` reads, as a Prisma `select`.
 *
 * Spread this wherever a query feeds a verification claim, rather than
 * selecting `verification` alone. Selecting only the column is how the guest
 * catalogue came to show a lapsed partner as verified: the page had no way to
 * ask the live question because the live question's inputs were not loaded, and
 * `verification !== 'VERIFIED'` is always available and always nearly right.
 */
export const VERIFICATION_STANDING_SELECT = {
  verification: true,
  verifiedChecks: true,
  insuranceExpiresOn: true,
} as const

/**
 * Whether a stored verification still holds today.
 *
 * Deliberately a pure function over the row plus `now`, so the same answer is
 * available to the admin list, the guest surface and a test, and so none of
 * them reads the clock during render (`CLAUDE.md`, UI conventions). Callers
 * pass `now`; the default exists for convenience in server code.
 */
export function verificationStanding(
  supplier: StandingInput,
  now = new Date(),
): VerificationStanding {
  if (supplier.verification === VerificationStatus.REJECTED) {
    return {
      standing: 'rejected',
      reason: 'This partner was rejected. Nothing of theirs may be published.',
      expiredOn: null,
      missingChecks: [],
    }
  }

  if (supplier.verification !== VerificationStatus.VERIFIED) {
    const missing = REQUIRED_CHECK_KEYS.filter((key) => !supplier.verifiedChecks.includes(key))
    return {
      standing: 'unverified',
      reason:
        missing.length === 0
          ? 'Every required check is recorded, but no verification decision has been made.'
          : `${String(missing.length)} required check${missing.length === 1 ? '' : 's'} not yet recorded.`,
      expiredOn: null,
      missingChecks: missing,
    }
  }

  /*
   * Verified, but is it still true?
   *
   * First: a VERIFIED row whose checklist is incomplete. Every verification
   * recorded before ADR-036 is in that state — an empty `verifiedChecks` and no
   * expiry — because the service that wrote it had no checklist to fill in.
   * Those read as lapsed, which is what `docs/supplier-verification.md`
   * promises and what the honest statement is: nobody can now say what was
   * checked. Falling through to `verified` here would have kept a guest-facing
   * badge resting on a decision whose evidence does not exist, which is the
   * one thing ADR-036 was for.
   *
   * It is the derived answer that changes, never the stored one. ARC does not
   * rewrite somebody's recorded decision (non-negotiable 6); it stops
   * repeating the claim until the checks are recorded again.
   */
  const missingRequired = REQUIRED_CHECK_KEYS.filter(
    (key) => !supplier.verifiedChecks.includes(key),
  )
  if (missingRequired.length > 0) {
    return {
      standing: 'lapsed',
      reason:
        `Recorded as verified, but ${String(missingRequired.length)} required ` +
        `check${missingRequired.length === 1 ? '' : 's'} ${missingRequired.length === 1 ? 'is' : 'are'} ` +
        'not on file, so nobody can say what was checked. Re-check and record them.',
      expiredOn: null,
      missingChecks: missingRequired,
    }
  }

  /*
   * Then the insurance date. A verified partner with the insurance check
   * recorded and no expiry on file predates that field. Treated as lapsed
   * rather than silently trusted: the honest statement is "nobody knows when
   * that certificate expires", and recording the date takes a minute.
   */
  if (supplier.verifiedChecks.includes(INSURANCE_CHECK_KEY)) {
    if (!supplier.insuranceExpiresOn) {
      return {
        standing: 'lapsed',
        reason:
          'Insurance was checked but no expiry date was recorded, so nobody can say whether the ' +
          'policy is still in force. Re-check and record the date.',
        expiredOn: null,
        missingChecks: [],
      }
    }

    /*
     * Compared as calendar days, not instants. A certificate expiring today is
     * in force today; `@db.Date` columns and `DateKey` strings are how this
     * codebase handles that (`src/lib/dates`), and comparing a midnight
     * timestamp against `now` would expire it a day early in every timezone
     * west of UTC — which is all of Mexico.
     */
    const expires = toDateKey(supplier.insuranceExpiresOn)
    if (expires < toDateKey(now)) {
      return {
        standing: 'lapsed',
        reason: `The insurance certificate on file expired on ${expires}.`,
        expiredOn: expires,
        missingChecks: [],
      }
    }
  }

  return { standing: 'verified', reason: null, expiredOn: null, missingChecks: [] }
}

/** True only when the verification holds right now. For guest-facing copy. */
export const isCurrentlyVerified = (supplier: StandingInput, now = new Date()): boolean =>
  verificationStanding(supplier, now).standing === 'verified'

/**
 * How many days until the insurance on file expires, or null when it does not
 * apply. Negative when it already has.
 *
 * Exists so an admin list can sort by "about to stop being true" rather than
 * waiting for it to become false.
 */
export function daysUntilInsuranceExpiry(
  supplier: Pick<StandingInput, 'insuranceExpiresOn'>,
  now = new Date(),
): number | null {
  if (!supplier.insuranceExpiresOn) return null
  const day = 24 * 60 * 60 * 1000
  const expires = Date.parse(`${toDateKey(supplier.insuranceExpiresOn)}T00:00:00Z`)
  const today = Date.parse(`${toDateKey(now)}T00:00:00Z`)
  return Math.round((expires - today) / day)
}
