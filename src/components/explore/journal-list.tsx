'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import type { Article, ArticleCategory } from '@/modules/discovery/content/types'

const CATEGORIES: (ArticleCategory | 'All')[] = [
  'All',
  'Destination Stories',
  'Adventure',
  'Cultural Guides',
  'Travel Technology',
]

/**
 * The journal index, with its category chips.
 *
 * A client component for the chips alone; the article bodies and dates are
 * formatted on the server and passed in as `formattedDate`, so nothing here
 * parses a date or reads a clock.
 */
export function JournalList({
  articles,
  featured,
  dates,
}: {
  articles: Article[]
  featured: Article | null
  /** Slug → server-formatted date, so the client does no date maths. */
  dates: Record<string, string>
}) {
  const [category, setCategory] = useState<ArticleCategory | 'All'>('All')

  const rest = articles.filter(
    (article) =>
      article.slug !== featured?.slug &&
      (category === 'All' || article.category === category),
  )
  const showFeatured = featured !== null && (category === 'All' || featured.category === category)

  return (
    <>
      <div className="no-scrollbar -mx-5 mt-8 flex gap-2 overflow-x-auto px-5 md:mx-0 md:px-0">
        {CATEGORIES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setCategory(item)}
            aria-pressed={category === item}
            className={cn(
              'h-10 rounded-full border px-4 text-sm whitespace-nowrap transition-colors duration-150',
              category === item
                ? 'bg-ink text-ivory border-ink'
                : 'text-ink border-line hover:border-ink bg-transparent',
            )}
          >
            {item}
          </button>
        ))}
      </div>

      {showFeatured && featured ? (
        <Link
          href={`/journal/${featured.slug}`}
          className="group mt-10 grid items-center gap-8 lg:grid-cols-[1.5fr_1fr] lg:gap-12"
        >
          <div className="bg-sand relative aspect-16/10 overflow-hidden rounded-3xl">
            <Image
              src={featured.image}
              alt=""
              fill
              sizes="(max-width: 1024px) 100vw, 60vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          </div>
          <div>
            <p className="text-gold-deep text-sm">Featured · {featured.category}</p>
            <h2 className="group-hover:text-sage mt-3 text-4xl leading-[1.05] transition-colors duration-150 md:text-5xl">
              {featured.title}
            </h2>
            <p className="text-muted mt-4 text-lg leading-relaxed">{featured.dek}</p>
            <p className="mt-6 text-sm">
              {featured.author}{' '}
              <span className="text-muted">
                · {dates[featured.slug]} · {featured.readMinutes} min read
              </span>
            </p>
          </div>
        </Link>
      ) : null}

      {rest.length > 0 ? (
        <div className="mt-16 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {rest.map((article) => (
            <Link
              key={article.slug}
              href={`/journal/${article.slug}`}
              className="group flex flex-col"
            >
              <div className="bg-sand relative aspect-4/5 overflow-hidden rounded-2xl">
                <Image
                  src={article.image}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 100vw, 25vw"
                  className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
              </div>
              <p className="text-gold-deep mt-4 text-xs">{article.category}</p>
              <h3 className="group-hover:text-sage mt-1 text-xl leading-snug transition-colors duration-150">
                {article.title}
              </h3>
              <p className="text-muted mt-2 line-clamp-2 text-sm leading-relaxed">{article.dek}</p>
              <p className="text-muted mt-auto pt-3 text-xs">
                {article.author} · {article.readMinutes} min
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-muted mt-10 text-sm">No articles in this section yet.</p>
      )}
    </>
  )
}
