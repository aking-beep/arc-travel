import Link from 'next/link'
import { Clock, MapPin, ShieldQuestion, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { Money } from '@/components/money'
import { createTranslator } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { listGuestCatalog } from '@/modules/guest/portal'
import { resolvePortalForRequest } from '../resolve'

export const metadata = { title: 'Explore' }

export default async function ExplorePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ category?: string }>
}) {
  const [{ token }, { category }] = await Promise.all([params, searchParams])
  const context = await resolvePortalForRequest(token)
  const locale = await getLocale()
  const t = createTranslator(locale)

  const all = await listGuestCatalog(context.propertyId)
  const categories = [...new Set(all.map((e) => e.category))]
  const filtered = category ? all.filter((e) => e.category === category) : all

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-semibold">{t('guest.explore')}</h2>
        <p className="text-sand-600 mt-1 text-sm">
          Everything {context.property.name} can book for you, with who runs it and what it costs.
        </p>
      </div>

      <nav aria-label="Categories" className="scrollbar-none -mx-5 flex gap-2 overflow-x-auto px-5">
        <Link
          href={`/g/${token}/explore`}
          aria-current={!category ? 'true' : undefined}
          className={
            !category
              ? 'bg-jade-800 rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap text-white'
              : 'border-sand-300 text-sand-700 rounded-full border px-3.5 py-1.5 text-sm whitespace-nowrap'
          }
        >
          All
        </Link>
        {categories.map((c) => (
          <Link
            key={c}
            href={`/g/${token}/explore?category=${c}`}
            aria-current={category === c ? 'true' : undefined}
            className={
              category === c
                ? 'bg-jade-800 rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap text-white'
                : 'border-sand-300 text-sand-700 rounded-full border px-3.5 py-1.5 text-sm whitespace-nowrap'
            }
          >
            {t(`category.${c}`)}
          </Link>
        ))}
      </nav>

      {filtered.length === 0 ? (
        <EmptyState title={t('common.empty')} />
      ) : (
        <div className="space-y-4">
          {filtered.map((experience) => {
            const basePrice =
              experience.prices.find((p) => p.kind === 'BASE') ?? experience.prices[0]
            const unverified = experience.supplier.verification !== 'VERIFIED'

            return (
              <Card key={experience.id}>
                <CardContent className="p-4">
                  <Link href={`/g/${token}/experience/${experience.slug}`} className="block">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {(locale === 'es' && experience.titleEs) || experience.titleEn}
                        </p>
                        <p className="text-sand-500 text-xs">{experience.supplier.name}</p>
                      </div>
                      <Badge tone="brand">{t(`category.${experience.category}`)}</Badge>
                    </div>

                    {experience.summaryEn ? (
                      <p className="text-sand-600 mt-2 text-sm">
                        {(locale === 'es' && experience.summaryEs) || experience.summaryEn}
                      </p>
                    ) : null}

                    <div className="text-sand-600 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                      <span className="flex items-center gap-1">
                        <Clock className="size-3.5" aria-hidden />
                        {experience.durationMinutes} {t('common.minutes')}
                      </span>
                      {experience.place ? (
                        <span className="flex items-center gap-1">
                          <MapPin className="size-3.5" aria-hidden />
                          {experience.place.name}
                        </span>
                      ) : null}
                      <span className="flex items-center gap-1">
                        <Users className="size-3.5" aria-hidden />
                        {experience.minParty}–{experience.maxParty}
                      </span>
                      <span>
                        {t('guest.abilityRange')} {t(`ability.${experience.minAbility}`)}–
                        {t(`ability.${experience.maxAbility}`)}
                      </span>
                    </div>

                    <div className="border-sand-200 mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                      <p className="text-sm">
                        {basePrice ? (
                          <>
                            <span className="text-sand-500 text-xs">{t('common.from')} </span>
                            <Money
                              amountMinor={basePrice.amountMinor}
                              currency={basePrice.currency}
                              className="font-semibold"
                            />
                            <span className="text-sand-500 text-xs"> {t('common.perPerson')}</span>
                          </>
                        ) : (
                          <span className="text-sand-500 text-xs">No price set</span>
                        )}
                      </p>
                      {unverified ? (
                        <span className="text-sand-500 flex items-center gap-1 text-xs">
                          <ShieldQuestion className="size-3.5" aria-hidden />
                          {t('common.unverified')}
                        </span>
                      ) : (
                        <Badge tone="success">{t('common.verified')}</Badge>
                      )}
                    </div>
                  </Link>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <p className="text-sand-500 text-xs leading-relaxed">
        “{t('common.unverified')}” means ARC has not checked that partner’s documents. Certifications
        they list are their own claims. All prices are demo data.
      </p>
    </div>
  )
}
