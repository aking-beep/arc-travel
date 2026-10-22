import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { addDays, format } from 'date-fns'
import { Itinerary, PlannerPreferences } from '../data/types'
import { sampleItineraries } from '../data/itineraries'
import { getDestination } from '../data/destinations'
import { activeGenerator } from '../lib/planner'
import { useSaved } from '../store/SavedContext'
import { PlannerForm } from '../components/PlannerForm'
import { ItineraryBuilder } from '../components/ItineraryBuilder'

const defaultPrefs = (destination = 'puerto-escondido'): PlannerPreferences => {
  const start = addDays(new Date(), 45)
  return {
    destination,
    startDate: format(start, 'yyyy-MM-dd'),
    endDate: format(addDays(start, 5), 'yyyy-MM-dd'),
    travelers: 2,
    budget: 'Comfort',
    style: getDestination(destination)?.styles[0] ?? 'Surf & Ocean',
    accommodation: 'Any',
    activities: ['Adventure', 'Food'],
    pace: 'Balanced',
  }
}

export function PlanPage() {
  const [params, setParams] = useSearchParams()
  const saved = useSaved()
  const [prefs, setPrefs] = useState<PlannerPreferences>(() => defaultPrefs(params.get('destination') ?? undefined))
  const [itinerary, setItinerary] = useState<Itinerary | null>(null)
  const [generating, setGenerating] = useState(false)

  // Open a sample or a saved itinerary from the URL.
  useEffect(() => {
    const sampleId = params.get('sample')
    const savedId = params.get('itinerary')
    if (!sampleId && !savedId) return
    const found = sampleId ? sampleItineraries.find((s) => s.id === sampleId) : saved.itineraries.find((s) => s.id === savedId)
    if (found) {
      setItinerary(found)
      setPrefs(found.preferences)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const generate = async (p: PlannerPreferences) => {
    setGenerating(true)
    const result = await activeGenerator.generate(p)
    setItinerary(result)
    setGenerating(false)
    window.scrollTo({ top: 0 })
  }

  const backToEdit = () => {
    setItinerary(null)
    if (params.get('sample') || params.get('itinerary')) setParams({}, { replace: true })
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="max-w-7xl mx-auto px-5 md:px-8 pt-8 md:pt-14 pb-20">
      <AnimatePresence mode="wait">
        {itinerary ? (
          <motion.div key="result" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
            <ItineraryBuilder
              itinerary={itinerary}
              onChange={setItinerary}
              onEditPreferences={backToEdit}
              generatorLabel={itinerary.source === 'sample' ? 'Sample itinerary' : activeGenerator.label}
            />
          </motion.div>
        ) : (
          <motion.div key="form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
            <PlannerForm value={prefs} onChange={setPrefs} onGenerate={() => generate(prefs)} generating={generating} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
