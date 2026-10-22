import React from 'react'
import { Link, useParams } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { getArticle, articles } from '../data/articles'
import { getDestination } from '../data/destinations'
import { NotFoundPage } from './NotFoundPage'

export function ArticlePage() {
  const { slug } = useParams()
  const a = getArticle(slug)
  if (!a) return <NotFoundPage />
  const dest = getDestination(a.destination)
  const idx = articles.indexOf(a)
  const next = articles[(idx + 1) % articles.length]

  return (
    <article className="pb-20">
      <header className="max-w-3xl mx-auto px-5 pt-10 md:pt-16 text-center">
        <Link to="/journal" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft className="w-4 h-4" />The Journal</Link>
        <p className="mt-8 text-sm text-gold-deep">{a.category}</p>
        <h1 className="font-serif text-4xl md:text-6xl leading-[1.05] tracking-tight mt-3">{a.title}</h1>
        <p className="mt-5 text-lg md:text-xl text-muted font-serif italic leading-relaxed">{a.dek}</p>
        <p className="mt-6 text-sm">{a.author} <span className="text-muted">· {format(parseISO(a.date), 'd MMMM yyyy')} · {a.readMinutes} min read</span></p>
      </header>

      <div className="max-w-6xl mx-auto px-5 md:px-8 mt-10 md:mt-14">
        <img src={a.image} alt="" className="w-full aspect-[16/9] object-cover rounded-3xl" />
      </div>

      <div className="max-w-[680px] mx-auto px-5 mt-12 md:mt-16">
        {a.body.map((b, i) => (
          <React.Fragment key={i}>
            {b.heading && <h2 className="font-serif text-2xl md:text-3xl mt-12 mb-4">{b.heading}</h2>}
            <p className={`text-[17px] leading-[1.8] text-ink-soft mb-6 ${i === 0 ? 'first-letter:font-serif first-letter:text-6xl first-letter:float-left first-letter:mr-3 first-letter:leading-[0.9] first-letter:text-gold-deep' : ''}`}>{b.text}</p>
            {i === 1 && a.pullQuote && (
              <blockquote className="my-12 border-l-2 border-gold pl-6 font-serif italic text-2xl md:text-3xl leading-snug">“{a.pullQuote}”</blockquote>
            )}
          </React.Fragment>
        ))}

        {dest && (
          <div className="mt-14 bg-paper rounded-3xl p-6 md:p-8 flex flex-col sm:flex-row gap-6 items-start sm:items-center">
            <img src={dest.image} alt="" className="w-24 h-24 rounded-2xl object-cover" />
            <div className="flex-1">
              <p className="text-xs text-muted">Inspired?</p>
              <p className="font-serif text-2xl">Travel to {dest.name}</p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <Link to={`/destinations/${dest.slug}`} className="border-b border-gold pb-0.5">Destination guide</Link>
                <Link to={`/plan?destination=${dest.slug}`} className="border-b border-gold pb-0.5">Plan a trip</Link>
                <Link to={`/culture/${dest.slug}`} className="border-b border-gold pb-0.5">Culture Context</Link>
              </div>
            </div>
          </div>
        )}

        <Link to={`/journal/${next.slug}`} className="group mt-14 pt-8 border-t border-line flex items-center justify-between gap-6">
          <span>
            <span className="block text-xs text-muted">Next story</span>
            <span className="block font-serif text-2xl mt-1 group-hover:text-sage transition-colors duration-150">{next.title}</span>
          </span>
          <ArrowRight className="w-5 h-5 shrink-0" />
        </Link>
      </div>
    </article>
  )
}
