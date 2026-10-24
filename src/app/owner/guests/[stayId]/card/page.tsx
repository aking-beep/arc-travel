import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { toDateKey } from '@/lib/dates'
import { StayStatus } from '@/lib/prisma-types'
import { requireActor } from '@/modules/auth/service'
import { assertPropertyAccess } from '@/modules/tenancy/context'
import { PORTAL_GRACE_DAYS } from '@/modules/guest/portal'

export const metadata = {
  title: 'Arrival card',
  robots: { index: false, follow: false },
}

/**
 * The card the desk prints and hands over.
 *
 * Deliberately plain: a heading, the guest's name, the link in large monospace,
 * and the dates. No QR image — generating one would mean either a new
 * dependency or a hand-rolled encoder whose output nothing here can verify, and
 * a wrong QR code at a front desk is worse than a legible URL. The hotel's own
 * key-card printer can encode the same URL, and `docs/pilot-plan.md` records
 * printing a QR as outstanding.
 *
 * It is a normal authorised page, not a public one: the token is on it, so it
 * goes through `assertPropertyAccess` like every other operator route.
 */
export default async function ArrivalCardPage({
  params,
}: {
  params: Promise<{ stayId: string }>
}) {
  const { stayId } = await params
  const actor = await requireActor()

  const stay = await prisma.stay.findUnique({
    where: { id: stayId },
    select: {
      id: true,
      reference: true,
      propertyId: true,
      portalToken: true,
      checkIn: true,
      checkOut: true,
      status: true,
      guest: { select: { firstName: true, lastName: true, locale: true } },
      property: { select: { name: true, contactPhone: true, checkInTime: true } },
    },
  })
  if (!stay) notFound()

  await assertPropertyAccess(actor, stay.propertyId)

  if (stay.status === StayStatus.CANCELLED || stay.status === StayStatus.NO_SHOW) notFound()

  const checkOut = toDateKey(stay.checkOut)
  const spanish = stay.guest.locale === 'ES'

  const copy = spanish
    ? {
        greeting: `Bienvenido, ${stay.guest.firstName}`,
        lede: 'Abre este enlace en tu teléfono para planificar tu viaje con nosotros.',
        validUntil: `Válido hasta el ${toDateKey(
          new Date(stay.checkOut.getTime() + PORTAL_GRACE_DAYS * 86_400_000),
        )}`,
        reference: 'Reserva',
        warning:
          'Este enlace es personal. Cualquiera que lo tenga puede ver tu plan y tu cesta, así que trátalo como la llave de tu habitación.',
      }
    : {
        greeting: `Welcome, ${stay.guest.firstName}`,
        lede: 'Open this link on your phone to plan your trip with us.',
        validUntil: `Valid until ${toDateKey(
          new Date(stay.checkOut.getTime() + PORTAL_GRACE_DAYS * 86_400_000),
        )}`,
        reference: 'Booking',
        warning:
          'This link is personal. Anyone holding it can see your plan and your basket, so treat it like your room key.',
      }

  return (
    <div className="mx-auto max-w-xl">
      <div className="print:hidden">
        <Link
          href="/owner/guests"
          className="text-jade-800 text-sm underline underline-offset-4"
        >
          ← Back to guests
        </Link>
        <p className="text-sand-600 mt-2 text-sm">
          Print this, or read the link out. It is the guest’s only credential.
        </p>
      </div>

      <article className="border-sand-300 mt-6 rounded-2xl border bg-white p-8 print:border-0 print:p-0">
        <p className="text-sand-500 text-xs tracking-wide uppercase">{stay.property.name}</p>
        <h1 className="font-display mt-2 text-3xl font-semibold">{copy.greeting}</h1>
        <p className="text-sand-700 mt-3 text-sm leading-relaxed">{copy.lede}</p>

        <p className="border-sand-300 mt-6 rounded-xl border border-dashed px-4 py-5 text-center font-mono text-base break-all">
          /g/{stay.portalToken}
        </p>

        <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-sand-500 text-xs">{copy.reference}</dt>
            <dd className="font-medium">{stay.reference}</dd>
          </div>
          <div>
            <dt className="text-sand-500 text-xs">Check-in</dt>
            <dd className="font-medium">
              {toDateKey(stay.checkIn)} · {stay.property.checkInTime}
            </dd>
          </div>
          <div>
            <dt className="text-sand-500 text-xs">Check-out</dt>
            <dd className="font-medium">{checkOut}</dd>
          </div>
        </dl>

        <p className="text-sand-500 mt-6 text-xs leading-relaxed">{copy.validUntil}.</p>
        <p className="text-sand-600 mt-2 text-xs leading-relaxed">{copy.warning}</p>
        {stay.property.contactPhone ? (
          <p className="text-sand-500 mt-2 text-xs">{stay.property.contactPhone}</p>
        ) : null}
      </article>
    </div>
  )
}
