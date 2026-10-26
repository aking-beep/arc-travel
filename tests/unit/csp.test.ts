import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from '@/middleware'

/**
 * The policy is the only thing standing between an injected script and the
 * page, and it has one conditional in it: Stripe's hosts.
 *
 * Collecting a card means loading a script from `js.stripe.com` and letting it
 * open an iframe from the same origin. There is no version of taking a payment
 * that does not widen the policy, so the question is only whether a deployment
 * that takes no payments carries the widening anyway — and the hosted demo
 * takes none.
 */
const directives = (csp: string): Map<string, string> =>
  new Map(
    csp.split('; ').map((directive) => {
      const [name, ...rest] = directive.split(' ')
      return [name ?? '', rest.join(' ')]
    }),
  )

describe('content security policy', () => {
  it('names no third-party script source when no live payment provider is set', () => {
    const csp = directives(contentSecurityPolicy('n0nce', false, { allowStripe: false }))

    expect(csp.get('script-src')).toBe("'self' 'nonce-n0nce' 'strict-dynamic'")
    // Nothing on a demo deployment needs to be framed, and a frame source
    // nobody uses is one nobody revisits.
    expect(csp.get('frame-src')).toBe("'none'")
    expect(csp.get('connect-src')).toBe("'self'")
    expect(csp.get('default-src')).toBe("'self'")
  })

  it('allows exactly Stripe’s hosts when a live provider is set', () => {
    const csp = directives(contentSecurityPolicy('n0nce', false, { allowStripe: true }))

    expect(csp.get('script-src')).toBe(
      "'self' 'nonce-n0nce' 'strict-dynamic' https://js.stripe.com",
    )
    expect(csp.get('frame-src')).toBe('https://js.stripe.com')
    expect(csp.get('connect-src')).toBe("'self' https://api.stripe.com https://js.stripe.com")
  })

  it('never relaxes the directives that are not about Stripe', () => {
    for (const allowStripe of [true, false]) {
      const csp = directives(contentSecurityPolicy('n0nce', false, { allowStripe }))
      expect(csp.get('object-src')).toBe("'none'")
      expect(csp.get('base-uri')).toBe("'self'")
      expect(csp.get('form-action')).toBe("'self'")
      expect(csp.get('frame-ancestors')).toBe("'none'")
      expect(csp.has('upgrade-insecure-requests')).toBe(true)
      // `unsafe-eval` is for the dev overlay and must never reach production.
      expect(csp.get('script-src')).not.toContain('unsafe-eval')
    }
  })

  it('carries no stray whitespace when a directive’s optional parts are absent', () => {
    // The script-src is assembled from four optional fragments. Doubled spaces
    // are harmless to a browser and make every assertion here brittle, so they
    // are collapsed at the source rather than tolerated.
    const csp = contentSecurityPolicy('n0nce', false, { allowStripe: false })
    expect(csp).not.toMatch(/ {2}/)
    expect(csp).not.toMatch(/ ;/)
  })

  it('allows eval only in development', () => {
    expect(contentSecurityPolicy('n', true, { allowStripe: false })).toContain("'unsafe-eval'")
    expect(contentSecurityPolicy('n', false, { allowStripe: false })).not.toContain("'unsafe-eval'")
  })
})
