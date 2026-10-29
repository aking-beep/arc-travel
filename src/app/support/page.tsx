import Link from 'next/link'
import { DemoBanner } from '@/components/demo-banner'
import { getPublicProperty } from '@/modules/discovery/service'

export const metadata = {
  title: 'Help · ARC Stay',
  description: 'How bookings work, how to change one, and who to ask.',
}

export const dynamic = 'force-dynamic'

/**
 * The page a guest looks for when something has gone wrong.
 *
 * There was not one. `/support`, `/help`, `/contact` and `/faq` all 404'd, so
 * a visitor who had just paid had no way to ask a question, no statement of
 * what happens if they need to cancel, and nothing forward-looking on the
 * confirmation page beyond "each partner confirms their own booking".
 *
 * Two things it deliberately does not do. It does not invent a support desk:
 * ARC is not the supplier of anything here and the hotel is the right first
 * call, which is why the property's own number is read from the database
 * rather than written into this file. And it does not restate the
 * cancellation policy as a rule — the window that applies is the one stored
 * on the experience, shown on the order, and this page says where to read it
 * rather than asserting a number that would eventually disagree with the
 * data.
 */
const SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: 'What you are buying',
    body: [
      'ARC sells experiences — a surf lesson, a cooking class, a boat trip — run by local partners around a hotel. Each one is a real departure with a real number of seats, and buying it holds a place on it.',
      'ARC does not sell rooms. It holds no room calendar for any hotel, so it will not tell you a bed is free. A room estimate on a property page is the published rate and nothing more; the booking is made with the hotel directly.',
      'ARC is not the supplier of any experience. The partner named on your booking runs it, on their own terms, and they are the people on the beach in the morning.',
    ],
  },
  {
    heading: 'After you pay',
    body: [
      'Your order appears straight away on your account, and the same page shows the day, the time and the meeting point for every line.',
      'Each partner confirms their own booking in their own time. Until they do, the line reads "awaiting the partner". That is normal and it is not a problem with your payment — your seat is held either way.',
      'A confirmation is written for every order. Whether it is delivered depends on the deployment: this one records messages rather than sending them, so check your account rather than your inbox.',
    ],
  },
  {
    heading: 'Changing or cancelling',
    body: [
      'Every experience carries its own cancellation window, set by the partner who runs it. It is shown on the experience and on your order, and it is the one that applies — ARC does not have a single policy that overrides what a partner agreed.',
      'To cancel, open the booking on your account and use the cancellation on the line. A refund, where one is due, is recorded against the order so you can see it against what you paid.',
      'If the window has passed, or the line will not cancel, the hotel is the right people to ask. They can see your booking by its reference.',
    ],
  },
  {
    heading: 'Conditions, and what we will not tell you',
    body: [
      'ARC reports ocean and weather readings with the time they were taken and where they came from, and refuses to recommend what those readings do not support. It never says a beach, a wave or an activity is safe, and no part of this product will.',
      'If a departure is greyed out, the reason is printed under it. The commonest is that you have not told us your level in the water, and we would rather ask than guess on a demanding day.',
      'On the day, your guide and the local lifeguards are the authority on whether to go in. Nothing on this site replaces them.',
    ],
  },
  {
    heading: 'Your account and your data',
    body: [
      'An account is created at the till, with the email address you paid under. If you booked through a hotel instead, you can add that booking to your account with its reference and the email the property holds for you.',
      'A forgotten password is reset from the sign-in page. For security the reset answers the same way whether or not an account exists, so no reply does not mean no account.',
      'What is collected and why is set out in the privacy notice.',
    ],
  },
]

export default async function SupportPage() {
  /*
   * The hotel's own number, from the published property, rather than a support
   * line this product does not staff. Read defensively: with no property
   * published there is simply no contact block, which is better than printing
   * a number that reaches nobody.
   */
  let property: { name: string; phone: string | null } | null = null
  try {
    const published = await getPublicProperty()
    property = { name: published.name, phone: published.contactPhone ?? null }
  } catch {
    property = null
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10">
        <h1 className="font-display text-3xl font-semibold">Help</h1>
        <p className="text-sand-600 mt-2 text-sm leading-relaxed">
          How a booking works, what happens if you need to change one, and who to ask.
        </p>

        <div className="mt-8 space-y-8">
          {SECTIONS.map((section) => (
            <section key={section.heading}>
              <h2 className="font-display text-lg font-semibold">{section.heading}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph} className="text-sand-700 mt-3 text-sm leading-relaxed">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}

          <section>
            <h2 className="font-display text-lg font-semibold">Who to ask</h2>
            <p className="text-sand-700 mt-3 text-sm leading-relaxed">
              For anything about a booking you have made — a time, a meeting point, a
              cancellation — the hotel is the first call. They can find your booking by its
              reference and they can reach the partner.
            </p>
            {property?.phone ? (
              <p className="text-sand-700 mt-3 text-sm leading-relaxed">
                {property.name}:{' '}
                <a
                  href={`tel:${property.phone.replace(/\s+/g, '')}`}
                  className="text-jade-800 underline underline-offset-4"
                >
                  {property.phone}
                </a>
              </p>
            ) : null}
            <p className="text-sand-600 mt-3 text-sm leading-relaxed">
              This is a demonstration build, so the hotel, the partners and the numbers on it are
              synthetic. There is no ARC support desk behind this page yet, and inventing one
              would be the kind of claim the rest of the product exists not to make.
            </p>
          </section>
        </div>

        <p className="text-sand-600 mt-10 text-sm">
          See also the{' '}
          <Link href="/terms" className="text-jade-800 underline underline-offset-4">
            terms of service
          </Link>{' '}
          and the{' '}
          <Link href="/privacy" className="text-jade-800 underline underline-offset-4">
            privacy notice
          </Link>
          .
        </p>
      </main>
    </div>
  )
}
