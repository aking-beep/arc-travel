import React, { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Menu, X, Heart } from 'lucide-react'
import { useSaved } from '../store/SavedContext'

export const NAV_LINKS = [
  { to: '/destinations', label: 'Destinations' },
  { to: '/stays', label: 'Stays' },
  { to: '/experiences', label: 'Experiences' },
  { to: '/plan', label: 'Trip Planner' },
  { to: '/journal', label: 'Journal' },
]

export function Navbar() {
  const { pathname } = useLocation()
  const saved = useSaved()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const overHero = pathname === '/' || /^\/destinations\/[^/]+$/.test(pathname)
  const transparent = overHero && !scrolled && !open
  const count = saved.destinations.length + saved.stays.length + saved.experiences.length + saved.itineraries.length

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => setOpen(false), [pathname])

  return (
    <header
      className={`${overHero ? 'fixed' : 'sticky'} top-0 inset-x-0 z-50 transition-[background-color,border-color,color] duration-200 ${
        transparent ? 'bg-transparent text-ivory border-transparent' : 'bg-ivory/95 backdrop-blur text-ink border-line'
      } border-b`}
    >
      <div className="max-w-7xl mx-auto px-5 md:px-8 h-16 md:h-20 flex items-center justify-between gap-6">
        <Link to="/" className="flex items-baseline gap-2 shrink-0" aria-label="ARC Travel home">
          <span className="font-serif text-2xl tracking-tight">ARC</span>
          <span className={`text-[11px] tracking-[0.3em] uppercase ${transparent ? 'text-ivory/80' : 'text-gold-deep'}`}>Travel</span>
        </Link>

        <nav className="hidden lg:flex items-center gap-8">
          {NAV_LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `text-sm whitespace-nowrap py-1 border-b transition-colors duration-150 ${
                  isActive ? (transparent ? 'border-ivory' : 'border-gold text-ink') : 'border-transparent hover:border-current'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2 md:gap-3">
          <Link
            to="/trips"
            className={`relative hidden sm:flex items-center gap-2 text-sm px-3 py-2 rounded-full transition-colors duration-150 ${
              transparent ? 'hover:bg-ivory/10' : 'hover:bg-paper'
            }`}
          >
            <Heart className="w-4 h-4" />
            <span className="whitespace-nowrap">My Trips</span>
            {count > 0 && (
              <span className="min-w-5 h-5 px-1 rounded-full bg-gold text-ink text-[11px] font-semibold flex items-center justify-center">{count}</span>
            )}
          </Link>
          <Link
            to="/plan"
            className={`hidden md:inline-flex text-sm px-4 py-2.5 rounded-full whitespace-nowrap transition-colors duration-150 ${
              transparent ? 'bg-ivory text-ink hover:bg-paper' : 'bg-ink text-ivory hover:bg-ink-soft'
            }`}
          >
            Plan a journey
          </Link>
          <button
            onClick={() => setOpen((o) => !o)}
            className="lg:hidden w-11 h-11 flex items-center justify-center rounded-full"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="lg:hidden bg-ivory text-ink border-t border-line px-5 pb-6"
          >
            {[{ to: '/', label: 'Home' }, ...NAV_LINKS, { to: '/trips', label: 'My Trips' }].map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                className={({ isActive }) => `block py-4 border-b border-line font-serif text-2xl ${isActive ? 'text-gold-deep' : ''}`}
              >
                {l.label}
              </NavLink>
            ))}
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  )
}
