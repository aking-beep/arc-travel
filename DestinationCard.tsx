import React from 'react'
import { Link } from 'react-router-dom'
import { Destination } from '../data/types'
import { SaveButton } from './SaveButton'

type Props = { key?: React.Key; destination: Destination; size?: 'default' | 'tall' | 'wide' }

export function DestinationCard({ destination: d, size = 'default' }: Props) {
  const aspect = size === 'tall' ? 'aspect-[3/4]' : size === 'wide' ? 'aspect-[16/10]' : 'aspect-[4/5]'
  return (
    <Link to={`/destinations/${d.slug}`} className="group block">
      <div className={`relative ${aspect} overflow-hidden rounded-2xl bg-sand`}>
        <img
          src={d.image}
          alt={`${d.name}, ${d.country}`}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.03]"
        />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(to_top,rgba(32,40,36,0.75),transparent)]" />
        <div className="absolute top-3 right-3">
          <SaveButton kind="destinations" slug={d.slug} label={d.name} />
        </div>
        <div className="absolute bottom-0 inset-x-0 p-5 text-ivory">
          <p className="text-xs text-ivory/80">{d.country} · {d.region}</p>
          <h3 className="font-serif text-2xl md:text-[28px] leading-tight mt-1">{d.name}</h3>
        </div>
      </div>
      <p className="mt-3 text-sm text-muted leading-relaxed line-clamp-2">{d.tagline}</p>
      <p className="mt-1 text-sm text-ink">From ${d.dailyFrom}/day <span className="text-muted">· est. per person</span></p>
    </Link>
  )
}
