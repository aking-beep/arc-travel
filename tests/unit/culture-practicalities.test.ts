import { describe, expect, it } from 'vitest'
import { cultureGuides } from '@/modules/discovery/content/culture'

/**
 * The practical half of a culture guide.
 *
 * These exist because the answer panel was asked "how do I get around" and
 * had nothing to answer from — the notes mentioned taxis twice, in passing,
 * under etiquette and tipping. The model behaved correctly and said so, which
 * read to the person asking as the model being broken.
 *
 * Content is prose and cannot be asserted. What can be asserted is that every
 * destination has some, that it holds to the same no-rotting-facts rule as
 * the rest of the file, and that the outbound sources are real absolute URLs
 * rather than the plausible-looking ones a model would write.
 */
describe('getting around', () => {
  it('is written for every destination', () => {
    for (const guide of cultureGuides) {
      expect(guide.gettingAround.length, guide.destination).toBeGreaterThanOrEqual(3)
      for (const item of guide.gettingAround) {
        expect(item.title.length, guide.destination).toBeGreaterThan(0)
        expect(item.text.length, guide.destination).toBeGreaterThan(40)
      }
    }
  })

  it('never claims anything is safe', () => {
    // Non-negotiable 1, applied to the new prose as much as the old.
    for (const guide of cultureGuides) {
      const prose = guide.gettingAround.map((item) => `${item.title} ${item.text}`).join(' ')
      expect(prose, guide.destination).not.toMatch(/\bis safe\b|\bsafe to\b|\bsafe today\b/i)
    }
  })

  it('quotes no fare, price or clock time', () => {
    /*
     * The rule `guide-answer`'s prompt states and this content has to keep:
     * a wrong fare or opening time for a real place somebody is about to
     * travel to is worse than no answer, and prose in a repository goes stale
     * silently. Which modes exist and how you hail one does not rot.
     */
    const rots = /[€$£]\s?\d|\b\d+\s?(?:pesos?|euros?|rand|rupiah|idr|mxn|zar)\b|\b\d{1,2}[:.]\d{2}\s?(?:am|pm)?\b/i
    for (const guide of cultureGuides) {
      for (const item of guide.gettingAround) {
        expect(item.text, `${guide.destination}: ${item.title}`).not.toMatch(rots)
      }
    }
  })
})

describe('where to look next', () => {
  it('gives every destination at least one absolute https source', () => {
    for (const guide of cultureGuides) {
      expect(guide.elsewhere.length, guide.destination).toBeGreaterThan(0)
      for (const source of guide.elsewhere) {
        expect(source.href, guide.destination).toMatch(/^https:\/\//)
        // Parses as a URL rather than merely starting like one.
        expect(() => new URL(source.href), guide.destination).not.toThrow()
        expect(source.label.length, guide.destination).toBeGreaterThan(0)
        expect(source.covers.length, guide.destination).toBeGreaterThan(0)
      }
    }
  })

  it('points at one destination each, with no duplicated label', () => {
    for (const guide of cultureGuides) {
      const labels = guide.elsewhere.map((source) => source.label)
      expect(new Set(labels).size, guide.destination).toBe(labels.length)
    }
  })
})
