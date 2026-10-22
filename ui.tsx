import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BadgeCheck, Info } from 'lucide-react'
import { Verification } from '../data/types'

export function VerificationBadge({ status, onImage = false }: { status: Verification; onImage?: boolean }) {
  if (status === 'verified') {
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full whitespace-nowrap ${onImage ? 'bg-ivory/95 text-sage' : 'bg-sage-soft text-sage'}`}>
        <BadgeCheck className="w-3.5 h-3.5" /> Verified partner
      </span>
    )
  }
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full whitespace-nowrap ${onImage ? 'bg-ink/70 text-ivory backdrop-blur' : 'bg-paper text-muted'}`}>
      <Info className="w-3.5 h-3.5" /> Illustrative listing
    </span>
  )
}

export function SectionHeading({
  title,
  kicker,
  action,
  className = '',
}: {
  title: string
  kicker?: string
  action?: { to: string; label: string }
  className?: string
}) {
  return (
    <div className={`flex items-end justify-between gap-6 mb-8 md:mb-10 ${className}`}>
      <div className="max-w-2xl">
        <h2 className="font-serif text-3xl md:text-[42px] leading-[1.1] tracking-tight text-ink">{title}</h2>
        {kicker && <p className="mt-3 text-muted text-[15px] leading-relaxed">{kicker}</p>}
      </div>
      {action && (
        <Link to={action.to} className="hidden sm:inline-flex items-center gap-2 text-sm text-ink border-b border-gold pb-1 whitespace-nowrap hover:text-gold-deep transition-colors duration-150">
          {action.label} <ArrowRight className="w-4 h-4" />
        </Link>
      )}
    </div>
  )
}

export function Chip({ active, onClick, children }: { key?: React.Key; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-10 px-4 rounded-full border text-sm whitespace-nowrap transition-colors duration-150 ${
        active ? 'bg-ink text-ivory border-ink' : 'bg-transparent text-ink border-line hover:border-ink'
      }`}
    >
      {children}
    </button>
  )
}

export function money(n: number) {
  return '$' + Math.round(n).toLocaleString('en-US')
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="py-16 text-center border border-dashed border-line rounded-2xl">
      <p className="font-serif text-2xl">{title}</p>
      <p className="mt-2 text-muted text-sm max-w-md mx-auto">{text}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
