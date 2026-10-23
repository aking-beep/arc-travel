import Link from 'next/link'
import { getTranslator } from '@/lib/i18n/server'

export default async function ExploreNotFound() {
  const { t } = await getTranslator()

  return (
    <div className="mx-auto max-w-7xl px-5 py-32 text-center md:px-8">
      <h1 className="text-4xl md:text-5xl">{t('explore.notFound.title')}</h1>
      <p className="text-muted mx-auto mt-4 max-w-md leading-relaxed">
        {t('explore.notFound.body')}
      </p>
      <Link
        href="/explore"
        className="bg-ink text-ivory hover:bg-ink-soft mt-8 inline-flex h-12 items-center rounded-full px-6 text-sm transition-colors duration-150"
      >
        {t('explore.notFound.cta')}
      </Link>
    </div>
  )
}
