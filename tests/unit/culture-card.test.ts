import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CultureCard } from '@/components/guest/culture-card'
import { createTranslator } from '@/lib/i18n'
import { FixtureTravelAdviceProvider } from '@/modules/integrations/defaults'
import { providerFailed } from '@/modules/integrations/types'
import { buildBrief } from '@/modules/culture-context/brief'
import { DESTINATION_COUNTRIES } from '@/modules/culture-context/destinations'
import type { GuestCultureBrief } from '@/modules/culture-context/service'

/**
 * The guest card, rendered to HTML in both languages.
 *
 * "Advisory never becomes law" has to hold where a guest reads it, not only
 * in the types. These render the real component over a real brief.
 */
const MEXICO = DESTINATION_COUNTRIES['puerto-escondido']!
const profile = {
  nationality: null,
  destinationCountry: 'MX',
  destinationSlug: 'mexico',
  activities: ['surfing'],
}

async function render(locale: 'en' | 'es', failing = false) {
  const brief = await buildBrief(profile, {
    travelAdvice: failing
      ? { name: 'govuk', isLive: true, getAdvice: async () => providerFailed('govuk', 'timeout') }
      : new FixtureTravelAdviceProvider(),
    now: new Date('2026-10-21T12:00:00Z'),
  })
  const result: GuestCultureBrief = { brief, country: MEXICO, changeNotice: null }
  return renderToStaticMarkup(createElement(CultureCard, { result, locale }))
}

const count = (html: string, needle: string) => html.split(needle).length - 1

describe('CultureCard (EN)', () => {
  it('labels every item as travel advice, not the law of Mexico', async () => {
    const html = await render('en')
    const items = count(html, 'data-testid="culture-item"')
    expect(items).toBe(3)
    expect(count(html, 'Travel advice, not the law of Mexico')).toBe(items)
    expect(html).not.toContain('Law of Mexico, verified')
  })

  it('shows authority, class, jurisdiction, retrieval time, link and OGL attribution on each item', async () => {
    const html = await render('en')
    expect(count(html, 'UK Foreign, Commonwealth &amp; Development Office')).toBeGreaterThanOrEqual(3)
    expect(count(html, 'Government advisory')).toBe(3)
    expect(html).toContain('Applies in: </dt><dd class="inline">MX')
    expect(html).toContain('2026-10-21 00:00 UTC')
    expect(count(html, 'href="https://www.gov.uk/foreign-travel-advice/mexico"')).toBeGreaterThanOrEqual(3)
    expect(count(html, 'data-testid="culture-attribution"')).toBe(3)
    expect(html).toContain('Open Government Licence v3.0')
    expect(html).toContain('Not reviewed by ARC')
  })

  it('marks the fixture as demo text', async () => {
    const html = await render('en')
    expect(html).toContain('data-testid="culture-fixture"')
    expect(html).toContain('not the live page')
  })

  it('renders the source-down state as a visible notice, with no items', async () => {
    const html = await render('en', true)
    expect(html).toContain('data-testid="culture-unavailable"')
    expect(html).toContain('We could not reach UK Foreign, Commonwealth &amp; Development Office')
    expect(html).not.toContain('data-testid="culture-item"')
    expect(html).not.toContain('Nothing from this source applies')
  })

  // no-fabrication.jsonl, "source-unavailable": no requirement or penalty language.
  it('says nothing about fines, penalties, illegality or requirements when the source is down', async () => {
    const text = (await render('en', true)).toLowerCase()
    for (const word of ['fine', 'penalty', 'illegal', 'required']) expect(text).not.toContain(word)
  })
})

describe('CultureCard (ES, Mexico)', () => {
  it('labels every item as a travel advisory, not the law of México', async () => {
    const html = await render('es')
    expect(count(html, 'Aviso de viaje, no es la ley de México')).toBe(3)
    expect(html).toContain('Requisitos de entrada')
    expect(html).toContain('Leyes y costumbres locales')
    expect(html).toContain('Aviso de un gobierno')
    expect(html).toContain('El texto de la fuente se muestra en inglés')
  })

  it('renders the source-down state in Spanish, without penalty language', async () => {
    const html = (await render('es', true)).toLowerCase()
    expect(html).toContain('no pudimos consultar')
    for (const word of ['multa', 'sanción', 'ilegal', 'obligatorio']) expect(html).not.toContain(word)
  })
})

describe('culture copy', () => {
  it('never calls an advisory the law in either language', () => {
    for (const locale of ['en', 'es'] as const) {
      const t = createTranslator(locale)
      const label = t('culture.kind.ADVISORY', { country: 'X' }).toLowerCase()
      expect(label).toMatch(locale === 'en' ? /not the law/ : /no es la ley/)
    }
  })
})
