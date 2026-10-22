import React from 'react'
import { Link } from 'react-router-dom'
import { Clock, Gauge } from 'lucide-react'
import { Experience } from '../data/types'
import { getDestination } from '../data/destinations'
import { SaveButton } from './SaveButton'
import { VerificationBadge } from './ui'

export function ExperienceCard({ experience: e }: { key?: React.Key; experience: Experience }) {
  const dest = getDestination(e.destination)
  return (
    <Link to={`/experiences/${e.slug}`} className="group flex flex-col h-full">
      <div className="relative aspect-[5/4] overflow-hidden rounded-2xl bg-sand">
        <img
          src={e.image}
          alt={e.title}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.03]"
        />
        <div className="absolute top-3 left-3"><VerificationBadge status={e.verification} onImage /></div>
        <div className="absolute top-3 right-3"><SaveButton kind="experiences" slug={e.slug} label={e.title} /></div>
        <span className="absolute bottom-3 left-3 text-[11px] px-2.5 py-1 rounded-full bg-ivory/95 text-ink">{e.category} · {e.activity}</span>
      </div>
      <div className="pt-4 flex flex-col flex-1">
        <p className="text-xs text-muted">{dest?.name}, {dest?.country}</p>
        <h3 className="font-serif text-xl mt-1 leading-snug">{e.title}</h3>
        <div className="mt-2 flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{e.duration}</span>
          <span className="flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5" />{e.difficulty}</span>
        </div>
        <p className="mt-auto pt-3 text-sm"><span className="font-medium">${e.price}</span> <span className="text-muted">per person</span></p>
      </div>
    </Link>
  )
}
