import React from 'react'
import { NavLink } from 'react-router-dom'
import { Home, Compass, Sparkles, BedDouble, Heart } from 'lucide-react'

const ITEMS = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/destinations', label: 'Explore', icon: Compass },
  { to: '/plan', label: 'Plan', icon: Sparkles },
  { to: '/stays', label: 'Stays', icon: BedDouble },
  { to: '/trips', label: 'Trips', icon: Heart },
]

export function MobileNavigation() {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-ivory/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]" aria-label="Primary">
      <ul className="grid grid-cols-5">
        {ITEMS.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) => `flex flex-col items-center gap-1 py-2.5 text-[11px] ${isActive ? 'text-ink' : 'text-muted'}`}
            >
              {({ isActive }) => (
                <>
                  <Icon className={`w-5 h-5 ${isActive ? 'text-gold-deep' : ''}`} strokeWidth={isActive ? 2 : 1.5} />
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
