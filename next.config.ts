import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  images: {
    /*
     * The public destination surface uses the imagery that shipped with the
     * Magic Patterns export, which is hosted on that CDN. Allow-listed by exact
     * host and path prefix rather than by wildcard, so the optimiser cannot be
     * pointed at an arbitrary origin through a crafted `src`.
     *
     * `docs/decisions.md` ADR-025 records why this build carries destination
     * imagery at all, against the earlier decision not to.
     */
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.magicpatterns.com',
        pathname: '/patterns/generated-images/**',
      },
    ],
  },
  experimental: {
    // Domain modules are server-only; keep them out of the client graph.
    serverSourceMaps: false,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}

export default nextConfig
