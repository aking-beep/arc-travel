import React, { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { Navbar } from './Navbar'
import { Footer } from './Footer'
import { MobileNavigation } from './MobileNavigation'
import { useSaved } from '../store/SavedContext'

export function Layout() {
  const { pathname } = useLocation()
  const { toast } = useSaved()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="flex flex-col bg-ivory text-ink">
      <Navbar />
      <main className="flex-1 pb-20 md:pb-0">
        <Outlet />
      </main>
      <Footer />
      <MobileNavigation />
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 bg-ink text-ivory text-sm px-4 py-3 rounded-full shadow-lg"
            role="status"
          >
            <Check className="w-4 h-4 text-gold" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
