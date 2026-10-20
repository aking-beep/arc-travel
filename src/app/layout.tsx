import type { Metadata, Viewport } from 'next'
import { getLocale } from '@/lib/i18n/server'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'ARC Stay — Puerto Escondido',
    template: '%s · ARC Stay',
  },
  description:
    'ARC Stay turns an independent hotel’s local knowledge into personalised, bookable guest experiences. Demonstration environment for Puerto Escondido, Oaxaca.',
  applicationName: 'ARC Stay',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'ARC Stay', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#1F3A34',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()

  return (
    <html lang={locale}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  )
}
