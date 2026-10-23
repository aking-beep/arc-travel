import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Fragment } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { getTranslator } from '@/lib/i18n/server'
import { articles, getArticle } from '@/modules/discovery/content/articles'
import { getDestination } from '@/modules/discovery/content/destinations'

export async function generateStaticParams() {
  return articles.map((article) => ({ slug: article.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = getArticle(slug)
  return { title: article?.title ?? 'Journal' }
}

/** One journal article, ported from the export's `ArticlePage`. */
export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = getArticle(slug)
  if (!article) notFound()

  const { t, locale } = await getTranslator()
  const destination = getDestination(article.destination)
  const index = articles.findIndex((a) => a.slug === article.slug)
  const next = articles[(index + 1) % articles.length]

  const published = new Intl.DateTimeFormat(locale === 'es' ? 'es-MX' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(article.date))

  return (
    <article className="pb-20">
      <header className="mx-auto max-w-3xl px-5 pt-10 text-center md:pt-16">
        <Link
          href="/explore/journal"
          className="text-muted hover:text-ink inline-flex items-center gap-2 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden />
          The Journal
        </Link>
        <p className="text-gold-deep mt-8 text-sm">{article.category}</p>
        <h1 className="mt-3 text-4xl leading-[1.05] tracking-tight md:text-6xl">
          {article.title}
        </h1>
        <p className="text-muted mt-5 text-lg leading-relaxed italic md:text-xl">{article.dek}</p>
        <p className="mt-6 text-sm">
          {article.author}{' '}
          <span className="text-muted">
            · {published} · {article.readMinutes} min read
          </span>
        </p>
      </header>

      <div className="mx-auto mt-10 max-w-6xl px-5 md:mt-14 md:px-8">
        <div className="bg-sand relative aspect-16/9 w-full overflow-hidden rounded-3xl">
          <Image src={article.image} alt="" fill priority sizes="100vw" className="object-cover" />
        </div>
      </div>

      <div className="mx-auto mt-12 max-w-[680px] px-5 md:mt-16">
        {article.body.map((block, i) => (
          <Fragment key={block.text}>
            {block.heading ? (
              <h2 className="mt-12 mb-4 text-2xl md:text-3xl">{block.heading}</h2>
            ) : null}
            <p
              className={
                i === 0
                  ? 'text-ink-soft first-letter:text-gold-deep mb-6 text-[17px] leading-[1.8] first-letter:float-left first-letter:mr-3 first-letter:text-6xl first-letter:leading-[0.9]'
                  : 'text-ink-soft mb-6 text-[17px] leading-[1.8]'
              }
            >
              {block.text}
            </p>
            {i === 1 && article.pullQuote ? (
              <blockquote className="border-gold my-12 border-l-2 pl-6 text-2xl leading-snug italic md:text-3xl">
                &ldquo;{article.pullQuote}&rdquo;
              </blockquote>
            ) : null}
          </Fragment>
        ))}

        {destination ? (
          <div className="bg-paper mt-14 flex flex-col items-start gap-6 rounded-3xl p-6 sm:flex-row sm:items-center md:p-8">
            <div className="relative size-24 shrink-0 overflow-hidden rounded-2xl">
              <Image src={destination.image} alt="" fill sizes="96px" className="object-cover" />
            </div>
            <div className="flex-1">
              <p className="text-muted text-xs">Inspired?</p>
              <p className="text-2xl">Travel to {destination.name}</p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <Link
                  href={`/explore/destinations/${destination.slug}`}
                  className="border-gold border-b pb-0.5"
                >
                  Destination guide
                </Link>
                <Link
                  href={`/explore/plan?destination=${destination.slug}`}
                  className="border-gold border-b pb-0.5"
                >
                  {t('explore.nav.plan')}
                </Link>
                <Link
                  href={`/explore/culture/${destination.slug}`}
                  className="border-gold border-b pb-0.5"
                >
                  {t('explore.guide.cultureHeading')}
                </Link>
              </div>
            </div>
          </div>
        ) : null}

        {next ? (
          <Link
            href={`/explore/journal/${next.slug}`}
            className="group border-line mt-14 flex items-center justify-between gap-6 border-t pt-8"
          >
            <span>
              <span className="text-muted block text-xs">Next story</span>
              <span className="group-hover:text-sage mt-1 block text-2xl transition-colors duration-150">
                {next.title}
              </span>
            </span>
            <ArrowRight className="size-5 shrink-0" aria-hidden />
          </Link>
        ) : null}
      </div>
    </article>
  )
}
