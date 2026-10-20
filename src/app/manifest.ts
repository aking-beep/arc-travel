import type { MetadataRoute } from 'next'

/**
 * PWA manifest. The guest portal is designed to be installed from a QR code at
 * the front desk, so it has to behave like an app once added to a home screen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ARC Stay — Puerto Escondido',
    short_name: 'ARC Stay',
    description:
      'Your stay, planned around what you actually came for. Demonstration environment.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FAF8F4',
    theme_color: '#1F3A34',
    categories: ['travel', 'lifestyle'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  }
}
