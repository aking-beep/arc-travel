import { Shell } from '@/components/explore/editorial'
import { StayBrowser } from '@/components/explore/stay-browser'
import { getTranslator } from '@/lib/i18n/server'
import { stays } from '@/modules/discovery/content/stays'

export const metadata = { title: 'Stays' }

export default async function StaysPage({
  searchParams,
}: {
  searchParams: Promise<{ destination?: string }>
}) {
  const { destination } = await searchParams
  const { t, locale } = await getTranslator()

  return (
    <Shell className="pt-10 pb-20 md:pt-16">
      <header className="mb-10 max-w-2xl">
        <h1 className="text-4xl tracking-tight md:text-5xl">{t('explore.home.stayHeading')}</h1>
        <p className="text-muted mt-4 leading-relaxed">
          Small, characterful places — surf lodges, river-view rooms, fireside chalets.{' '}
          {t('explore.hero.demoNote')}
        </p>
      </header>

      <StayBrowser stays={stays} locale={locale} initialDestination={destination} />
    </Shell>
  )
}
