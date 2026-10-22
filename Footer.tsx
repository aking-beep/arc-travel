import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { destinations } from '../data/destinations'
import { useSaved } from '../store/SavedContext'

export function Footer() {
  const [email, setEmail] = useState('')
  const { notify } = useSaved()

  return (
    <footer className="bg-ink text-ivory/80">
      <div className="max-w-7xl mx-auto px-5 md:px-8 pt-16 pb-28 md:pb-12">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <p className="font-serif text-3xl text-ivory">ARC Travel</p>
            <p className="mt-2 font-serif italic text-gold">Go Beyond the Destination</p>
            <form
              className="mt-8 flex max-w-sm border-b border-ivory/30 focus-within:border-gold"
              onSubmit={(e) => {
                e.preventDefault()
                if (!email.includes('@')) return notify('Please enter a valid email')
                notify('Subscribed to the ARC Journal (prototype — no email sent)')
                setEmail('')
              }}
            >
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Your email for the Journal"
                className="flex-1 bg-transparent py-3 text-sm text-ivory placeholder:text-ivory/40 outline-none"
              />
              <button className="text-sm text-gold px-2 hover:text-ivory transition-colors duration-150">Subscribe</button>
            </form>
          </div>
          <FooterCol title="Explore" links={[['/destinations', 'Destinations'], ['/stays', 'Stays'], ['/experiences', 'Experiences'], ['/journal', 'Journal']]} />
          <FooterCol title="Plan" links={[['/plan', 'Trip Planner'], ['/trips', 'My Trips'], ['/culture/puerto-escondido', 'Culture Context'], ['/search', 'Search']]} />
          <FooterCol title="Destinations" links={destinations.slice(0, 5).map((d) => [`/destinations/${d.slug}`, d.name] as [string, string])} />
        </div>
        <div className="mt-16 pt-6 border-t border-ivory/15 flex flex-col md:flex-row gap-3 justify-between text-xs text-ivory/50">
          <p>© 2025 ARC Transformation Group. Prototype — all listings, prices and hosts are sample data.</p>
          <p>Planner uses a rules-based sample generator, not live AI.</p>
        </div>
      </div>
    </footer>
  )
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-ivory text-sm font-medium mb-4">{title}</p>
      <ul className="space-y-3 text-sm">
        {links.map(([to, label]) => (
          <li key={to}>
            <Link to={to} className="hover:text-gold transition-colors duration-150">{label}</Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
