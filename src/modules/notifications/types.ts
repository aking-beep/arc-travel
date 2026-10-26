import type { ProviderResult } from '@/modules/integrations/types'

/**
 * Transactional mail: a boundary of its own, deliberately not the
 * `MessagingProvider` one. See ADR-040.
 *
 * `MessagingProvider` exists for ARC *initiating* contact with a guest on a
 * hotel's behalf, and it refuses, because nothing in this product may message
 * a guest unprompted (non-negotiable 6). That refusal is right and stays.
 *
 * It is also not what a partner invitation is. An invitation is not outreach:
 * an owner filled in a form and pressed a button, the message goes to the
 * address they typed, and the message *is* the thing they asked to create — a
 * link only that person can use. The same holds for the confirmation of a
 * booking a guest just paid for, and for the reset of a password its owner just
 * asked to reset. Those three are the second half of an action a named person
 * took in the same request.
 *
 * Collapsing the two is why ARC Stay had no mail path at all, which meant a
 * hotel had to copy invitation links out of a flash message and read them down
 * the phone, and meant a guest who forgot their password had no way back.
 *
 * What a `Mailer` may therefore be given, and what the service enforces:
 *   - one recipient, which is an address already on the record the action
 *     touched. Never a list, never an address derived from anything else.
 *   - a message caused by a specific action, recorded alongside it.
 *
 * What it may never be given: a message to an audience, anything an agent
 * composed, anything on a schedule. Those are outbound messaging and they go
 * through the provider that refuses.
 */
export interface Mailer {
  readonly name: string
  /** True when this implementation actually hands mail to a network. */
  readonly canDeliver: boolean

  send(input: {
    to: { address: string; name: string | null }
    subject: string
    /** Plain text. The canonical body: everything is readable without HTML. */
    text: string
    /** Generated from `text`. A provider that wants only one part takes the text. */
    html: string
  }): Promise<ProviderResult<{ reference: string | null }>>
}
