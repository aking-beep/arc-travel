import Link from 'next/link'
import { DemoBanner } from '@/components/demo-banner'
import { PORTAL_GRACE_DAYS } from '@/modules/guest/portal'
import { TERMS_VERSION } from '@/modules/onboarding/service'

export const metadata = {
  title: 'Privacy notice · ARC Stay',
  description: 'What personal data ARC Stay holds, why, and for how long.',
}

/**
 * Privacy notice.
 *
 * Describes the handling the code actually implements — the redaction on the
 * way into the audit trail, the pseudonymised analytics subject, the
 * time-boxed portal token — rather than a generic notice. Where a commercial
 * launch needs something this build does not have (a named controller, a
 * retention schedule, a sub-processor list), it says so.
 */
const SECTIONS = [
  {
    heading: 'Who this is about',
    body: [
      'Two groups of people. Hotel staff and local partners, who hold accounts; and guests, who are given a portal link by the hotel they are staying with.',
      'The hotel is the controller of its guests’ data. ARC processes it on the hotel’s instructions.',
    ],
  },
  {
    heading: 'What is held about a guest',
    body: [
      'Name, stay dates, party size, language, and whatever the guest chooses to tell the intake form: interests, pace, budget, surf ability, transport preference, and free-text dietary, mobility and medical notes.',
      'The free-text notes exist because an itinerary that ignores a knee injury is worse than no itinerary. They are never sent to a model as instructions, and they are redacted by field name before anything is written to the audit trail — the trail records that a dietary note changed, never what it said.',
    ],
  },
  {
    heading: 'The portal link',
    body: [
      `A guest’s portal link is their only credential, so it is opaque, tied to one stay, and stops working ${PORTAL_GRACE_DAYS} days after check-out. It grants access to that stay’s plan and basket and to nothing else.`,
      'Attempts to guess one are rate-limited per caller. The hotel can issue a fresh link, which invalidates the old one.',
    ],
  },
  {
    heading: 'Analytics',
    body: [
      'Product analytics record what happened, not who it happened to: the subject of an event is a salted pseudonym, and an email address or phone number can never reach an analytics row.',
    ],
  },
  {
    heading: 'The AI explanations',
    body: [
      'ARC uses a language model to phrase the reasons its deterministic engine produced. The model has no tools and no write path: it cannot add a recommendation, remove one, or change a score. Free text from a guest or partner is screened for injection and labelled as data before it is sent, and every call is recorded with its inputs redacted.',
    ],
  },
  {
    heading: 'Payments',
    body: [
      'This build takes no payments and holds no card details. The payment provider is simulated, and a live provider is refused at startup while the build is in demo mode.',
    ],
  },
  {
    heading: 'Your rights',
    body: [
      'A guest may ask the hotel for a copy of what is held about them, ask for it to be corrected, or withdraw a consent they gave at intake — withdrawal is recorded and takes effect immediately on what ARC will use.',
      'Hotel and partner accounts can be exported or deleted on request.',
    ],
  },
  {
    heading: 'Still to be drafted',
    body: [
      'Before a real guest’s data is processed this notice needs: the named controller and any joint-controller arrangement, a retention schedule per data category, the list of sub-processors and where they host, the lawful basis stated per purpose, the international-transfer mechanism, and a contact for data-protection requests. These are outstanding, not implied.',
    ],
  },
]

export default function PrivacyPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10">
        <h1 className="font-display text-3xl font-semibold">Privacy notice</h1>
        <p className="text-sand-500 mt-2 text-sm">Version {TERMS_VERSION}</p>

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
        </div>

        <p className="text-sand-600 mt-10 text-sm">
          See also the{' '}
          <Link href="/terms" className="text-jade-800 underline underline-offset-4">
            terms of service
          </Link>
          .
        </p>
      </main>
    </div>
  )
}
