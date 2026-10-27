import type { Locator, Page } from '@playwright/test'

/**
 * What the persona can see, in as few tokens as will still support a decision.
 *
 * Every step sends one of these to the model, so its size *is* the running
 * cost. A full DOM would be tens of thousands of tokens a step and would make
 * the simulation cost more per hour than the product it is testing. What a
 * person actually uses is the text in front of them and the things they can
 * press, so that is what this collects — numbered, because the model then
 * chooses an affordance by number rather than inventing a CSS selector that
 * may match nothing or, worse, match something else.
 */

export interface Affordance {
  readonly index: number
  readonly kind: 'link' | 'button' | 'text' | 'select' | 'checkbox' | 'radio'
  /** How the thing announces itself: its label, its text, its placeholder. */
  readonly name: string
  /** For a field: what is in it now, so the model does not retype what is set. */
  readonly value?: string
}

export interface Observation {
  readonly path: string
  readonly title: string
  readonly heading: string
  /** Visible text, trimmed and bounded. */
  readonly text: string
  readonly affordances: readonly Affordance[]
}

/** The affordances, with the live handles the action will use. */
export interface ObservedPage {
  readonly observation: Observation
  readonly targets: readonly Locator[]
}

const MAX_AFFORDANCES = 45
const MAX_TEXT = 2_600

export async function observe(page: Page, baseUrl: string): Promise<ObservedPage> {
  await settled(page)

  const path = page.url().startsWith(baseUrl) ? page.url().slice(baseUrl.length) || '/' : page.url()

  const [title, heading, rawText] = await Promise.all([
    page.title().catch(() => ''),
    page
      .locator('h1')
      .first()
      .innerText()
      .catch(() => ''),
    page
      .locator('body')
      .innerText()
      .catch(() => ''),
  ])

  const candidates = page.locator(
    'a[href], button, [role="button"], input:not([type="hidden"]), select, textarea',
  )
  const count = Math.min(await candidates.count().catch(() => 0), 120)

  const affordances: Affordance[] = []
  const targets: Locator[] = []

  for (let i = 0; i < count && affordances.length < MAX_AFFORDANCES; i += 1) {
    const target = candidates.nth(i)
    if (!(await target.isVisible().catch(() => false))) continue

    const described = await describe(target)
    if (!described) continue

    affordances.push({ ...described, index: affordances.length + 1 })
    targets.push(target)
  }

  return {
    observation: {
      path,
      title,
      heading: heading.trim().slice(0, 160),
      text: squash(rawText).slice(0, MAX_TEXT),
      affordances,
    },
    targets,
  }
}

/**
 * Waits out a Suspense skeleton before reading the page.
 *
 * Every panel renders a loading state, so a page read the instant it arrives
 * says "Loading…" and nothing else. That would cost a model call to decide
 * about a page that was about to become a different page — and, worse, teach
 * the persona that the product shows it nothing. The pressure test learned the
 * same thing about `/me` (`agent.settled()`).
 */
async function settled(page: Page, timeout = 10_000): Promise<void> {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const text = await page
      .locator('body')
      .innerText()
      .catch(() => '')
    if (!/loading[\s.…]/i.test(text)) return
    await page.waitForTimeout(250)
  }
}

async function describe(target: Locator): Promise<Omit<Affordance, 'index'> | null> {
  const tag = await target.evaluate((el) => el.tagName.toLowerCase()).catch(() => '')
  if (!tag) return null

  const [aria, text, placeholder, name, type, value] = await Promise.all([
    target.getAttribute('aria-label').catch(() => null),
    target.innerText().catch(() => ''),
    target.getAttribute('placeholder').catch(() => null),
    target.getAttribute('name').catch(() => null),
    target.getAttribute('type').catch(() => null),
    target.inputValue().catch(() => undefined),
  ])

  const label = (aria ?? text ?? placeholder ?? name ?? '').replace(/\s+/g, ' ').trim().slice(0, 90)
  if (!label) return null

  if (tag === 'a') return { kind: 'link', name: label }
  if (tag === 'select') return { kind: 'select', name: label, value }
  if (tag === 'textarea') return { kind: 'text', name: label, value }
  if (tag === 'input') {
    if (type === 'checkbox') return { kind: 'checkbox', name: label, value }
    if (type === 'radio') return { kind: 'radio', name: label, value }
    if (type === 'submit' || type === 'button') return { kind: 'button', name: label }
    return { kind: 'text', name: label, value }
  }
  return { kind: 'button', name: label }
}

/**
 * Collapses the whitespace a rendered page is full of.
 *
 * Not cosmetic: blank lines and indentation are a material share of the token
 * count of a page's text, and they carry nothing a decision depends on.
 */
function squash(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
}
