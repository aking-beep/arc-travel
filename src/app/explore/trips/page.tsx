import { Shell } from '@/components/explore/editorial'
import { SavedTrips } from '@/components/explore/saved-trips'
import { toDateKey } from '@/lib/dates'
import { getTranslator } from '@/lib/i18n/server'

export const metadata = { title: 'Saved' }

export default async function TripsPage() {
  const { t, locale } = await getTranslator()

  // Computed on the server and passed down, so the client component does not
  // read the clock during render.
  const today = toDateKey(new Date())

  return (
    <Shell className="pt-10 pb-20 md:pt-16">
      <h1 className="text-5xl tracking-tight md:text-7xl">{t('explore.saved.heading')}</h1>
      <p className="text-muted mt-4 max-w-xl text-sm leading-relaxed">
        {t('explore.saved.lede')}
      </p>

      <SavedTrips locale={locale} today={today} />
    </Shell>
  )
}
