import React from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { SavedProvider } from './store/SavedContext'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { DestinationsPage } from './pages/DestinationsPage'
import { DestinationDetailPage } from './pages/DestinationDetailPage'
import { StaysPage } from './pages/StaysPage'
import { StayDetailPage } from './pages/StayDetailPage'
import { ExperiencesPage } from './pages/ExperiencesPage'
import { ExperienceDetailPage } from './pages/ExperienceDetailPage'
import { PlanPage } from './pages/PlanPage'
import { CulturePage } from './pages/CulturePage'
import { TripsPage } from './pages/TripsPage'
import { JournalPage } from './pages/JournalPage'
import { ArticlePage } from './pages/ArticlePage'
import { SearchPage } from './pages/SearchPage'
import { NotFoundPage } from './pages/NotFoundPage'

export function App() {
  return (
    <SavedProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/destinations" element={<DestinationsPage />} />
            <Route path="/destinations/:slug" element={<DestinationDetailPage />} />
            <Route path="/stays" element={<StaysPage />} />
            <Route path="/stays/:slug" element={<StayDetailPage />} />
            <Route path="/experiences" element={<ExperiencesPage />} />
            <Route path="/experiences/:slug" element={<ExperienceDetailPage />} />
            <Route path="/plan" element={<PlanPage />} />
            <Route path="/culture/:destination" element={<CulturePage />} />
            <Route path="/trips" element={<TripsPage />} />
            <Route path="/journal" element={<JournalPage />} />
            <Route path="/journal/:slug" element={<ArticlePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </HashRouter>
    </SavedProvider>
  )
}
