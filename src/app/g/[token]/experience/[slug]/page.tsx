import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Clock, MapPin, ShieldCheck, ShieldQuestion, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Money } from '@/components/money'
import { ConditionsCard } from '@/components/guest/conditions-card'
import { createTranslator } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { toLocalDateKey, toLocalTimeString } from '@/lib/dates'
import { getGuestExperience } from '@/modules/guest/portal'
import { isCurrentlyVerified } from '@/modules/admin/verification'
import { resolvePortalForRequest } from '../../resolve'
import { getConditions } from '@/modules/destination/conditions'
import { evaluateSlotsForGuest } from '@/modules/destination/suitability'
import { getGuestPreferences } from '@/modules/preferences/service'
import { ItemActions } from '../../itinerary-controls'

export default async function ExperienceDetailPage({
  params,
}: {
  params: Promise<{ token: string; slug: string }>
}) {
  const { token, slug } = await params
  const context = await resolvePortalForRequest(token)
  const experience = await getGuestExperience(context.propertyId, slug)
  if (!experience) notFound()

  const locale = await getLocale()
  const t = createTranslator(locale)
  const preferences = await getGuestPreferences(context.guestId)

  const slotDates = [...new Set(experience.slots.map((s) => toLocalDateKey(s.startsAt)))]
  const conditionsPlaceId = experience.placeId ?? experience.activity.placeId
  const conditions = conditionsPlaceId
    ? await getConditions([conditionsPlaceId], slotDates)
    : new Map()

  /**
   * Suitability per departure, evaluated now.
   *
   * This page is a route to a booking that does not go through the itinerary,
   * and it used to render an Add-to-basket button for every departure without
   * consulting the gate at all — so a beginner could open the advanced-only
   * Zicatela session and buy it. `addToCart` refuses server-side, but offering
   * a button that will be refused is its own kind of dishonesty.
   */
  const suitability = await evaluateSlotsForGuest({
    guestId: context.guestId,
    slotIds: experience.slots.map((slot) => slot.id),
  })

  const basePrice = experience.prices.find((p) => p.kind === 'BASE') ?? experience.prices[0]
  const groupPrice = experience.prices.find((p) => p.kind === 'GROUP')
  /*
   * The standing today, not the stored column: a partner verified in January on
   * a certificate that expired in March is not verified in December. ADR-036.
   */
  const verified = isCurrentlyVerified(experience.supplier)
  const partySize = preferences.partySize || context.partySize

  const byDate = new Map<string, typeof experience.slots>()
  for (const slot of experience.slots) {
    const key = toLocalDateKey(slot.startsAt)
    const bucket = byDate.get(key) ?? []
    bucket.push(slot)
    byDate.set(key, bucket)
  }

  const title = (locale === 'es' && experience.titleEs) || experience.titleEn
  const description =
    (locale === 'es' && experience.descriptionEs) || experience.descriptionEn
  const whatToBring = (locale === 'es' && experience.whatToBringEs) || experience.whatToBringEn
  const activitySafety =
    (locale === 'es' && experience.activity.safetyNotesEs) || experience.activity.safetyNotesEn
  const placeSafety = experience.place
    ? (locale === 'es' && experience.place.safetyNotesEs) || experience.place.safetyNotesEn
    : null

  return (
    <article className="space-y-5">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">{t(`category.${experience.category}`)}</Badge>
          {experience.guideIncluded ? <Badge tone="neutral">{t('guest.guideIncluded')}</Badge> : null}
          {experience.includesTransfer ? (
            <Badge tone="neutral">{t('guest.transferIncluded')}</Badge>
          ) : null}
        </div>
        <h2 className="font-display mt-2 text-2xl leading-tight font-semibold">{title}</h2>
        <p className="text-sand-600 mt-1 text-sm">{experience.supplier.name}</p>
      </header>

      <div className="text-sand-700 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="flex items-center gap-1.5">
          <Clock className="text-sand-400 size-4" aria-hidden />
          {experience.durationMinutes} {t('common.minutes')}
        </span>
        {experience.place ? (
          <span className="flex items-center gap-1.5">
            <MapPin className="text-sand-400 size-4" aria-hidden />
            {experience.place.name}
          </span>
        ) : null}
        <span className="flex items-center gap-1.5">
          <Users className="text-sand-400 size-4" aria-hidden />
          {experience.minParty}–{experience.maxParty} {t('common.people')}
        </span>
      </div>

      {description ? (
        <p className="text-sand-700 text-[0.9375rem] leading-relaxed">{description}</p>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Price</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {basePrice ? (
            <p>
              <Money
                intent="neutral"
                amountMinor={basePrice.amountMinor}
                currency={basePrice.currency}
                className="text-lg font-semibold"
              />{' '}
              <span className="text-sand-500">{t('common.perPerson')}</span>
            </p>
          ) : null}
          {basePrice && basePrice.bookingFeeMinor > 0 ? (
            <p className="text-sand-600">
              Plus a <Money amountMinor={basePrice.bookingFeeMinor} currency={basePrice.currency} intent="neutral" />{' '}
              booking fee, charged once.
            </p>
          ) : null}
          {groupPrice ? (
            <p className="text-sand-600">
              <Money amountMinor={groupPrice.amountMinor} currency={groupPrice.currency} intent="neutral" />{' '}
              {t('common.perPerson')} for {groupPrice.minParty} or more.
            </p>
          ) : null}
          <p className="text-sand-500 text-xs">
            Free cancellation up to {experience.cancellationPolicyHours} hours before. Demo data —
            nothing is charged.
          </p>
        </CardContent>
      </Card>

      <div
        className={
          verified
            ? 'rounded-xl border border-emerald-200 bg-emerald-50 p-4'
            : 'bg-sand-100 border-sand-300 rounded-xl border p-4'
        }
      >
        <p className="flex items-center gap-2 text-sm font-medium">
          {verified ? (
            <ShieldCheck className="size-4 text-emerald-700" aria-hidden />
          ) : (
            <ShieldQuestion className="text-sand-600 size-4" aria-hidden />
          )}
          {verified ? t('common.verified') : t('common.unverified')}
        </p>
        <p className="text-sand-600 mt-1 text-xs leading-relaxed">
          {verified
            ? 'ARC has checked this partner’s documents.'
            : 'ARC has not checked this partner’s documents. Anything below is what they told us, not what we confirmed.'}
        </p>
        {experience.supplier.claimedCertifications.length > 0 ? (
          <ul className="text-sand-600 mt-2 space-y-0.5 text-xs">
            {experience.supplier.claimedCertifications.map((cert) => (
              <li key={cert}>· {cert}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {activitySafety || placeSafety ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">Before you book</p>
          {activitySafety ? (
            <p className="mt-1 text-sm text-amber-900">{activitySafety}</p>
          ) : null}
          {placeSafety ? <p className="mt-1.5 text-sm text-amber-900">{placeSafety}</p> : null}
        </div>
      ) : null}

      {experience.meetingPoint ? (
        <div>
          <h3 className="text-sand-500 text-xs font-semibold tracking-wide uppercase">
            {t('guest.meetingPoint')}
          </h3>
          <p className="text-sand-700 mt-1 text-sm">{experience.meetingPoint}</p>
        </div>
      ) : null}

      {whatToBring ? (
        <div>
          <h3 className="text-sand-500 text-xs font-semibold tracking-wide uppercase">
            {t('guest.whatToBring')}
          </h3>
          <p className="text-sand-700 mt-1 text-sm">{whatToBring}</p>
        </div>
      ) : null}

      <section className="space-y-3">
        <h3 className="font-display text-base font-semibold">Next departures</h3>
        {byDate.size === 0 ? (
          <p className="text-sand-600 text-sm">
            No departures scheduled. Ask the front desk and they can request one from the partner.
          </p>
        ) : (
          [...byDate.entries()].slice(0, 7).map(([date, slots]) => {
            const snapshot = conditionsPlaceId
              ? conditions.get(`${conditionsPlaceId}:${date}`)
              : null
            return (
              <div key={date} className="border-sand-200 rounded-xl border p-4">
                <p className="text-sand-800 text-sm font-medium tabular-nums">{date}</p>
                <ul className="mt-2 space-y-3">
                  {slots.map((slot) => {
                    const verdict = suitability.get(slot.id)
                    const refused = verdict ? !verdict.allowed : true

                    return (
                      <li key={slot.id} className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm tabular-nums">
                            {toLocalTimeString(slot.startsAt)}
                          </span>
                          {refused ? (
                            <Badge tone="neutral">Not bookable for you</Badge>
                          ) : (
                            <ItemActions
                              token={token}
                              slotId={slot.id}
                              quantity={partySize}
                              remaining={Math.max(0, slot.capacity - slot.booked - slot.held)}
                              startsAt={toLocalTimeString(slot.startsAt)}
                              locale={locale}
                            />
                          )}
                        </div>
                        {refused && verdict?.notes.length ? (
                          <ul className="text-sand-600 space-y-0.5 text-xs">
                            {verdict.notes.map((note) => (
                              <li key={note}>· {note}</li>
                            ))}
                          </ul>
                        ) : null}
                        {refused && verdict?.guestAbility === null ? (
                          <Link
                            href={`/g/${token}/intake`}
                            className="text-jade-800 inline-block text-xs underline underline-offset-4"
                          >
                            Tell us your experience level
                          </Link>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
                {snapshot ? (
                  <ConditionsCard
                    snapshot={snapshot}
                    placeName={experience.place?.name ?? ''}
                    locale={locale}
                    compact
                    className="mt-3"
                  />
                ) : null}
              </div>
            )
          })
        )}
      </section>
    </article>
  )
}
