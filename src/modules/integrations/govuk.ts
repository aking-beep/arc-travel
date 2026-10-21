import {
  providerFailed,
  providerOk,
  type ProviderResult,
  type TravelAdviceDocument,
  type TravelAdviceProvider,
} from './types'

/**
 * GOV.UK FCDO travel advice, live.
 *
 * Reads the public Content API (`/api/content/foreign-travel-advice/{slug}`),
 * which needs no key. Every failure (bad slug, network, timeout, non-2xx,
 * non-JSON) comes back as `{ ok: false, reason }`; nothing is retried with a
 * guess and nothing is cached here. Refused while `ARC_DATA_MODE=demo` (see
 * `getEnv`), so the demo stays offline.
 */
export const GOVUK_CONTENT_API = 'https://www.gov.uk/api/content/foreign-travel-advice'
export const GOVUK_PUBLIC_BASE = 'https://www.gov.uk/foreign-travel-advice'

/** Slugs are interpolated into a URL path, so they are checked before use. */
const SLUG = /^[a-z0-9-]{2,80}$/

export const govukPublicUrl = (slug: string): string => `${GOVUK_PUBLIC_BASE}/${slug}`

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export class GovUkTravelAdviceProvider implements TravelAdviceProvider {
  readonly name = 'govuk'
  readonly isLive = true

  constructor(
    private readonly options: { fetch?: Fetch; timeoutMs?: number; now?: () => Date } = {},
  ) {}

  async getAdvice(input: { slug: string }): Promise<ProviderResult<TravelAdviceDocument>> {
    if (!SLUG.test(input.slug)) return providerFailed(this.name, 'invalid_slug')

    const fetchImpl = this.options.fetch ?? fetch
    let response: Response
    try {
      response = await fetchImpl(`${GOVUK_CONTENT_API}/${input.slug}`, {
        headers: { accept: 'application/json', 'user-agent': 'ARC-Stay/0.1 (culture-context)' },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 7_000),
        redirect: 'follow',
      })
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      return providerFailed(
        this.name,
        name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error',
      )
    }

    if (!response.ok) return providerFailed(this.name, `http_${response.status}`)

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return providerFailed(this.name, 'invalid_json')
    }
    if (payload === null || typeof payload !== 'object') {
      return providerFailed(this.name, 'unexpected_payload')
    }

    return providerOk(this.name, {
      slug: input.slug,
      sourceUrl: govukPublicUrl(input.slug),
      payload,
      retrievedAt: (this.options.now ?? (() => new Date()))(),
      isFixture: false,
    })
  }
}
