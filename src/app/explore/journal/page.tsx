import { Shell } from '@/components/explore/editorial'
import { JournalList } from '@/components/explore/journal-list'
import { getTranslator } from '@/lib/i18n/server'
import { articles } from '@/modules/discovery/content/articles'

export const metadata = { title: 'The Journal' }

export default async function JournalPage() {
  const { locale } = await getTranslator()

  // Dates are formatted here so the client component never parses one. The
  // export used date-fns in render; `src/lib/dates` exists so date handling
  // lives in one place, and `Intl` is the right tool for presentation.
  const formatter = new Intl.DateTimeFormat(locale === 'es' ? 'es-MX' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const dates = Object.fromEntries(
    articles.map((article) => [article.slug, formatter.format(new Date(article.date))]),
  )

  return (
    <Shell className="pt-10 pb-20 md:pt-16">
      <h1 className="text-5xl tracking-tight md:text-7xl">The Journal</h1>
      <p className="text-muted mt-4 max-w-xl leading-relaxed">
        Stories, field guides and notes on travelling well.
      </p>

      <JournalList
        articles={articles}
        featured={articles.find((a) => a.featured) ?? null}
        dates={dates}
      />
    </Shell>
  )
}
