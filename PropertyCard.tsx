import React from 'react'
import { Link } from 'react-router-dom'
import { Star } from 'lucide-react'
import { Property } from '../data/types'
import { getDestination } from '../data/destinations'
import { SaveButton } from './SaveButton'
import { VerificationBadge } from './ui'

type Props = { key?: React.Key; property: Property; layout?: 'card' | 'row' }

export function PropertyCard({ property: p, layout = 'card' }: Props) {
  const dest = getDestination(p.destination)
  if (layout === 'row') {
    return (
      <Link to={`/stays/${p.slug}`} className="group flex gap-4 p-3 rounded-xl hover:bg-paper transition-colors duration-150">
        <img src={p.images[0]} alt={p.name} className="w-24 h-24 rounded-lg object-cover shrink-0" />
        <div className="min-w-0 flex flex-col">
          <p className="text-xs text-muted">{p.type} · {dest?.name}</p>
          <p className="font-serif text-lg leading-tight truncate">{p.name}</p>
          <p className="mt-auto text-sm"><span className="font-medium">${p.pricePerNight}</span> <span className="text-muted">/ night</span></p>
        </div>
      </Link>
    )
  }
  return (
    <Link to={`/stays/${p.slug}`} className="group flex flex-col h-full">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-sand">
        <img
          src={p.images[0]}
          alt={p.name}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.03]"
        />
        <div className="absolute top-3 left-3"><VerificationBadge status={p.verification} onImage /></div>
        <div className="absolute top-3 right-3"><SaveButton kind="stays" slug={p.slug} label={p.name} /></div>
      </div>
      <div className="pt-4 flex flex-col flex-1">
        <div className="flex items-center justify-between gap-3 text-xs text-muted">
          <span className="truncate">{p.type} · {dest?.name}, {dest?.country}</span>
          <span className="flex items-center gap-1 text-ink shrink-0"><Star className="w-3.5 h-3.5 fill-gold text-gold" />{p.rating} <span className="text-muted">({p.reviews})</span></span>
        </div>
        <h3 className="font-serif text-xl mt-1.5 leading-snug">{p.name}</h3>
        <p className="text-sm text-muted mt-1.5 leading-relaxed line-clamp-2">{p.summary}</p>
        <p className="mt-auto pt-3 text-sm"><span className="font-medium text-ink">${p.pricePerNight}</span> <span className="text-muted">/ night · sample rate</span></p>
      </div>
    </Link>
  )
}
