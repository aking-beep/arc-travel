import { ExperienceBrowser } from '@/components/explore/experience-browser'
import { Shell } from '@/components/explore/editorial'
import { getTranslator } from '@/lib/i18n/server'
import { experiences } from '@/modules/discovery/content/experiences'

export const metadata = { title: 'Experiences' }

export default async function ExperiencesPage({
  searchParams,
}: {
  searchParams: Promise<{ destination?: string }>
}) {
  const { destination } = await searchParams
  const { t, locale } = await getTranslator()

  return (
    <Shell className="pt-10 pb-20 md:pt-16">
      <header className="mb-10 max-w-2xl">
        <h1 className="text-4xl tracking-tight md:text-5xl">{t('explore.experiences.heading')}</h1>
        <p className="text-muted mt-4 leading-relaxed">{t('explore.experiences.lede')}</p>
      </header>

      <ExperienceBrowser
        experiences={experiences}
        locale={locale}
        initialDestination={destination}
      />
    </Shell>
  )
}
