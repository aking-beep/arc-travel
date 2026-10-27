import type { Locator, Page } from '@playwright/test'

import type { SimulatedAction } from './decide'
import type { ObservedPage } from './observe'

/**
 * Carrying out a decision.
 *
 * Two rules, both learned next door in the pressure-test harness:
 *
 *  - An action that fails is an observation, not an exception. A button that
 *    moved, a navigation that timed out, a field that is not editable: the
 *    person notices and carries on, and the feed says what happened.
 *  - A `goto` may only go somewhere inside the product. Nothing a model wrote
 *    is allowed to decide which origin a browser session carrying demo
 *    credentials visits.
 */

export interface ActionOutcome {
  readonly summary: string
  readonly ok: boolean
  readonly detail?: string
  /** True when the scenario is over, however it ended. */
  readonly finished: boolean
}

const NAVIGATION_TIMEOUT = 20_000

export async function act(
  page: Page,
  observed: ObservedPage,
  action: SimulatedAction,
  baseUrl: string,
): Promise<ActionOutcome> {
  try {
    switch (action.type) {
      case 'finish':
        return { summary: `Done: ${action.because}`, ok: true, finished: true }

      case 'back':
        await page.goBack({ timeout: NAVIGATION_TIMEOUT })
        return { summary: 'Went back', ok: true, finished: false }

      case 'goto': {
        const path = safePath(action.path)
        if (!path) {
          return {
            summary: `Refused to leave the product for "${action.path}"`,
            ok: false,
            detail:
              'A simulated person may only navigate inside the target deployment. An absolute ' +
              'URL or a protocol-relative path is refused by the runner.',
            finished: false,
          }
        }
        await page.goto(`${baseUrl}${path}`, { timeout: NAVIGATION_TIMEOUT })
        return { summary: `Opened ${path}`, ok: true, finished: false }
      }

      case 'click': {
        const target = pick(observed, action.index)
        if (!target) return missing(action.index, observed)
        const name = observed.observation.affordances[action.index - 1]?.name ?? 'something'
        await target.click({ timeout: 10_000 })
        await settle(page)
        return { summary: `Pressed “${name}”`, ok: true, finished: false }
      }

      case 'fill': {
        const target = pick(observed, action.index)
        if (!target) return missing(action.index, observed)
        const name = observed.observation.affordances[action.index - 1]?.name ?? 'a field'
        await target.fill(action.value, { timeout: 10_000 })
        return { summary: `Typed into “${name}”`, ok: true, detail: action.value, finished: false }
      }

      case 'select': {
        const target = pick(observed, action.index)
        if (!target) return missing(action.index, observed)
        const name = observed.observation.affordances[action.index - 1]?.name ?? 'a choice'
        await target.selectOption(action.value, { timeout: 10_000 })
        await settle(page)
        return { summary: `Chose “${action.value}” in “${name}”`, ok: true, finished: false }
      }
    }
  } catch (error) {
    return {
      summary: 'That did not work',
      ok: false,
      detail: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 600) : String(error),
      finished: false,
    }
  }
}

function pick(observed: ObservedPage, index: number): Locator | null {
  return observed.targets[index - 1] ?? null
}

function missing(index: number, observed: ObservedPage): ActionOutcome {
  return {
    summary: `Looked for item ${index} and it was not there`,
    ok: false,
    detail: `The page offered ${observed.targets.length} things to do.`,
    finished: false,
  }
}

/** A path inside the product. Anything else is refused, loudly. */
function safePath(raw: string): string | null {
  const path = raw.trim()
  if (!path.startsWith('/')) return null
  if (path.startsWith('//')) return null
  if (path.includes('\\')) return null
  return path.slice(0, 200)
}

/**
 * Lets a server action land before the page is read again.
 *
 * `revalidatePath` remounts the route, and reading the page during that remount
 * is how the pressure-test harness once recorded a refusal as missing. A short
 * wait for the network to go quiet costs nothing and removes a whole class of
 * false findings.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined)
}
