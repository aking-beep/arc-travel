import { getEnv } from '@/lib/env'
import { providerFailed, providerOk } from '@/modules/integrations/types'
import type { ProviderResult } from '@/modules/integrations/types'
import type { Mailer } from './types'

/**
 * Records and delivers nothing.
 *
 * The default, and not a silent one: the caller has already written the message
 * to `EmailMessage`, so what this returns decides whether the row reads `SENT`
 * or `LOGGED`. A hotel evaluating ARC can then open `/owner/messages` and read
 * the exact text, address and link of everything the product would have sent —
 * which is a better answer than either sending for real or pretending.
 *
 * It returns ok rather than throwing, because nothing has gone wrong: this
 * deployment is configured not to deliver. `NoopMessagingProvider` throws
 * instead, and the difference is the point — that one is a refusal, this one is
 * a setting.
 */
export class LoggingMailer implements Mailer {
  readonly name = 'log'
  readonly canDeliver = false

  async send(): Promise<ProviderResult<{ reference: string | null }>> {
    return providerOk(this.name, { reference: null })
  }
}

/**
 * Posts to the Resend API over `fetch`.
 *
 * No SDK: one HTTP call against a documented JSON endpoint is less to audit and
 * less to keep current than a dependency, and this is the only call ARC makes.
 *
 * Two failures are told apart deliberately. A 4xx other than 429 is the
 * provider saying this message is wrong — a malformed address, an unverified
 * sending domain — and retrying it will fail identically for ever, so it is
 * permanent. Anything else is the network or the provider having a bad minute,
 * and the dispatcher will come back to it.
 */
export class ResendMailer implements Mailer {
  readonly name = 'resend'
  readonly canDeliver = true

  private readonly apiKey: string
  private readonly from: string
  private readonly replyTo: string | null

  constructor(input: { apiKey: string; from: string; replyTo?: string | null }) {
    this.apiKey = input.apiKey
    this.from = input.from
    this.replyTo = input.replyTo ?? null
  }

  async send(input: {
    to: { address: string; name: string | null }
    subject: string
    text: string
    html: string
  }): Promise<ProviderResult<{ reference: string | null }>> {
    let response: Response
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          // The display name is the recipient's own, from the record this
          // message is about. Quoted, because a name containing a comma would
          // otherwise read as a second recipient.
          to: [formatRecipient(input.to)],
          ...(this.replyTo ? { reply_to: this.replyTo } : {}),
          subject: input.subject,
          text: input.text,
          html: input.html,
        }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      // A timeout or a DNS failure. Transient by assumption, which is the safe
      // assumption: a retried invitation is a duplicate email, an abandoned one
      // is a partner who never gets in.
      return providerFailed(this.name, `transport: ${messageOf(error)}`)
    }

    if (response.ok) {
      const payload = (await response.json().catch(() => null)) as { id?: string } | null
      return providerOk(this.name, { reference: payload?.id ?? null })
    }

    const detail = (await response.text().catch(() => '')).slice(0, 500)
    const permanent = response.status >= 400 && response.status < 500 && response.status !== 429
    return providerFailed(
      this.name,
      `${permanent ? 'permanent' : 'transient'} ${response.status}: ${detail}`,
    )
  }
}

/**
 * True when a provider's reason says there is no point trying again.
 *
 * Shaped as a string check rather than an error subclass so the `Mailer`
 * interface stays a plain `ProviderResult`, the way every other boundary here
 * is. The prefix is this module's own, not the provider's text.
 */
export const isPermanentFailure = (reason: string | null): boolean =>
  Boolean(reason?.startsWith('permanent'))

export function formatRecipient(to: { address: string; name: string | null }): string {
  if (!to.name) return to.address
  // Strip what cannot appear in a display name rather than escaping it: a
  // recipient name comes from a hotel's typing, and a quote or a newline in it
  // is either a mistake or an attempt to add a header.
  const safe = to.name.replace(/["\\\r\n,;<>]/g, ' ').trim()
  return safe ? `"${safe}" <${to.address}>` : to.address
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error)

let cached: Mailer | null = null

/**
 * Chooses the implementation from the environment.
 *
 * `getEnv()` has already refused `resend` without a key and a from-address, and
 * refused a live provider on an open demo, so the assertions here are on a
 * contract rather than a hope.
 */
export function getMailer(): Mailer {
  if (cached) return cached
  const env = getEnv()

  if (env.MAIL_PROVIDER === 'resend' && env.ARC_ENABLE_TRANSACTIONAL_EMAIL) {
    cached = new ResendMailer({
      apiKey: env.RESEND_API_KEY ?? '',
      from: env.ARC_MAIL_FROM ?? '',
      replyTo: env.ARC_MAIL_REPLY_TO ?? null,
    })
    return cached
  }

  cached = new LoggingMailer()
  return cached
}

/** Test seam, matching `resetIntegrations()`. */
export function resetMailer(): void {
  cached = null
}
