import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { articles } from '../data/articles'
import { ArticleCategory } from '../data/types'
import { Chip } from '../components/ui'

const CATS: (ArticleCategory | 'All')[] = ['All', 'Destination Stories', 'Adventure', 'Cultural Guides', 'Travel Technology']

export function JournalPage() {
  const [cat, setCat] = useState<ArticleCategory | 'All'>('All')
  const featured = articles.find((a) => a.featured)!
  const list = articles.filter((a) => a !== featured && (cat === 'All' || a.category === cat))
  const showFeatured = cat === 'All' || featured.category === cat

  return (
    <div className="max-w-7xl mx-auto px-5 md:px-8 pt-10 md:pt-16 pb-20">
      <h1 className="font-serif text-5xl md:text-7xl tracking-tight">The Journal</h1>
      <p className="mt-4 text-muted max-w-xl leading-relaxed">Stories, field guides and notes on travelling well.</p>

      <div className="mt-8 flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5 md:mx-0 md:px-0">
        {CATS.map((c) => <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{c}</Chip>)}
      </div>

      {showFeatured && (
        <Link to={`/journal/${featured.slug}`} className="group mt-10 grid lg:grid-cols-[1.5fr_1fr] gap-8 lg:gap-12 items-center">
          <div className="aspect-[16/10] rounded-3xl overflow-hidden bg-sand">
            <img src={featured.image} alt="" className="w-full h-full object-cover transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.02]" />
          </div>
          <div>
            <p className="text-sm text-gold-deep">Featured · {featured.category}</p>
            <h2 className="font-serif text-4xl md:text-5xl leading-[1.05] mt-3 group-hover:text-sage transition-colors duration-150">{featured.title}</h2>
            <p className="mt-4 text-muted leading-relaxed text-lg">{featured.dek}</p>
            <p className="mt-6 text-sm">{featured.author} <span className="text-muted">· {format(parseISO(featured.date), 'd MMMM yyyy')} · {featured.readMinutes} min read</span></p>
          </div>
        </Link>
      )}

      <div className="mt-16 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-12">
        {list.map((a) => (
          <Link key={a.slug} to={`/journal/${a.slug}`} className="group flex flex-col">
            <div className="aspect-[4/5] rounded-2xl overflow-hidden bg-sand">
              <img src={a.image} alt="" className="w-full h-full object-cover transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.03]" />
            </div>
            <p className="mt-4 text-xs text-gold-deep">{a.category}</p>
            <h3 className="font-serif text-xl leading-snug mt-1 group-hover:text-sage transition-colors duration-150">{a.title}</h3>
            <p className="text-sm text-muted mt-2 leading-relaxed line-clamp-2">{a.dek}</p>
            <p className="mt-auto pt-3 text-xs text-muted">{a.author} · {a.readMinutes} min</p>
          </Link>
        ))}
      </div>
      {list.length === 0 && !showFeatured && <p className="mt-10 text-muted text-sm">No articles in this section yet.</p>}
    </div>
  )
}
