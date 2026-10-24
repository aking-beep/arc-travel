import Link from 'next/link'
import { DemoBanner } from '@/components/demo-banner'
import { TERMS_VERSION } from '@/modules/onboarding/service'

export const metadata = {
  title: 'Terms of service · ARC Stay',
  description: 'The terms on which ARC Stay is provided.',
}

/**
 * Terms of service.
 *
 * Written for what this build actually is and does, not for what a commercial
 * launch will need: a registration form that asks someone to accept terms has
 * to have terms to accept, and a page of plausible-looking legal boilerplate
 * would be worse than none. Everything below is a statement of fact about the
 * software. The clauses a commercial agreement needs — liability, governing
 * law, payment terms, termination — are flagged as outstanding rather than
 * invented, because drafting them is a lawyer's job and pretending otherwise
 * would be the same dishonesty the product is built to avoid.
 */
const SECTIONS = [
  {
    heading: 'What ARC Stay is',
    body: [
      'ARC Stay is software that lets an independent hotel present local experiences to its guests, take bookings for them, and account for the revenue they earn. It is supplied as a hosted service.',
      'ARC is not the supplier of any experience. Each experience is run by the local partner named on it, on that partner’s own terms. ARC does not guide, transport, instruct or insure anybody.',
    ],
  },
  {
    heading: 'Conditions, suitability and safety',
    body: [
      'ARC reports ocean and weather conditions with their source and the time they were observed, and uses them to decide what it is willing to recommend. ARC never states that an activity is safe. Whether to enter the water remains a decision for the guest, their guide and the lifeguards.',
      'Where no reading exists for a date, ARC judges the activity against the spot’s typical character and says that is what it has done. An absent reading is never treated as a green light.',
    ],
  },
  {
    heading: 'Verification',
    body: [
      'A partner, certification or property is shown as verified only after a named ARC reviewer has verified it. Anything a partner says about itself is shown as that partner’s claim, attributed to them.',
    ],
  },
  {
    heading: 'Your account',
    body: [
      'You are responsible for your own credentials and for the people you invite into your organization. An invitation link lets its holder set a password on the account it names, so treat it as a credential.',
      'You may close your account at any time and ask for your data to be exported or deleted.',
    ],
  },
  {
    heading: 'Money',
    body: [
      'All amounts are held and shown in the minor unit of their currency — centavos for pesos — and are never rounded into a float. Commission is split according to the agreement recorded against each partner, and the split is auditable line by line.',
      'Earned revenue and potential value are reported separately and are never added together.',
    ],
  },
  {
    heading: 'What this build does not do',
    body: [
      'This build takes no payments: the payment provider is simulated and a live provider is refused at startup while the build is in demo mode. It sends no messages on your behalf. It makes no consequential change without a recorded approval naming the person who decided.',
    ],
  },
  {
    heading: 'Still to be drafted',
    body: [
      'A commercial agreement needs clauses this page does not yet contain: limitation of liability, warranties, indemnities, governing law and jurisdiction, fees and payment terms, service levels, suspension and termination, and the data-processing terms that sit alongside the privacy notice. They are outstanding, not implied. Ask before relying on this page for anything contractual.',
    ],
  },
]

export default function TermsPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10">
        <h1 className="font-display text-3xl font-semibold">Terms of service</h1>
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
          <Link href="/privacy" className="text-jade-800 underline underline-offset-4">
            privacy notice
          </Link>
          .
        </p>
      </main>
    </div>
  )
}
