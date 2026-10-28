import { existsSync } from 'node:fs'

import { chromium, type Browser, type Page } from '@playwright/test'

import {
  DEFAULT_SIMULATION_MODEL,
  isSimulationModel,
  nanosToMinor,
  type SimulationModel,
} from '../../src/modules/simulation/pricing'
import { describe, safetyClaims, verificationClaims } from '../pressure-test/claims'
import { act } from './act'
import { Decider } from './decide'
import { observe } from './observe'
import { PERSONAS, type PersonaBrief } from './personas'
import { Reporter } from './reporter'
import { scenarioFor } from './scenarios'

/**
 * The live simulation runner.
 *
 * Six people take turns using the demo, improvising, while an operator watches
 * `/admin/simulation`. It runs until the operator stops it, the spend ceiling
 * is reached, or the cycles run out.
 *
 *   SIMULATION_BASE_URL=https://arc-stay-demo.vercel.app \
 *   SIMULATION_TOKEN=… ANTHROPIC_API_KEY=… \
 *   npm run simulate -- --model=claude-sonnet-5-5 --budget=5.00
 *
 * It is a process on somebody's machine rather than anything inside the
 * product, for two reasons that are the same reason: it drives a real browser,
 * which no serverless function hosts, and a simulation that could be started
 * from inside the deployment would be a privileged path into it. The only way
 * in is the runner's bearer token and the two routes it may call.
 *
 * ## The one thing it refuses
 *
 * It asks the target what it is, and runs only against an answer of `demo`.
 * Not a flag, not a URL pattern: the deployment's own statement. The personas
 * invent guests, race for seats and probe refusals, and there is exactly one
 * kind of data that may happen to. ADR-043.
 */

const BASE_URL = (process.env.SIMULATION_BASE_URL ?? 'http://127.0.0.1:3100').replace(/\/$/, '')
const TOKEN = process.env.SIMULATION_TOKEN ?? ''
const API_KEY = process.env.ANTHROPIC_API_KEY ?? ''
/*
 * The browser, resolved the way `playwright.config.ts` resolves it.
 *
 * Hardcoding the container's path meant the runner only started in the
 * container: on a normal checkout Playwright's own download is the right
 * answer and `executablePath` must simply be left off. Same fix as the
 * pressure test's (`scripts/pressure-test/run.ts`).
 */
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)

/** Steps a persona takes before the scenario ends and the next one starts. */
const MAX_STEPS = 14

function argValue(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
}

async function main(): Promise<void> {
  if (!TOKEN) fail('SIMULATION_TOKEN is not set. The runner authenticates with it.')
  if (!API_KEY) fail('ANTHROPIC_API_KEY is not set. The personas decide with it.')

  const model = resolveModel(argValue('model'))
  const budgetMinor = resolveBudget(argValue('budget'))
  const cycles = Number(argValue('cycles') ?? '0') || Number.POSITIVE_INFINITY
  const only = argValue('only')?.split(',').map((s) => s.trim()).filter(Boolean)

  const chosen = only ? PERSONAS.filter((p) => only.includes(p.id)) : PERSONAS
  if (chosen.length === 0) fail(`No persona matched --only=${only?.join(',') ?? ''}`)

  await preflight()

  const start = await post('/api/simulation/run', {
    targetUrl: BASE_URL,
    dataMode: 'demo',
    model,
    budgetMinor,
  })
  const runId = (start as { id: string }).id

  console.log(`▸ simulation ${runId}`)
  console.log(`  target ${BASE_URL} · ${model} · ceiling ${(budgetMinor / 100).toFixed(2)} USD\n`)

  const decider = new Decider(model, API_KEY)
  const reporter = new Reporter(runId, TOKEN, BASE_URL)

  const browser = await chromium.launch({
    ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
    args: ['--no-sandbox'],
  })

  let stopped: string | null = null
  try {
    for (let cycle = 0; cycle < cycles && !stopped; cycle += 1) {
      for (const persona of chosen) {
        stopped = await runScenario({ browser, persona, decider, reporter, cycle })
        if (stopped) break
      }
    }
  } catch (error) {
    stopped = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    await reporter.finish('FAILED', stopped, decider.totals)
    throw error
  } finally {
    await browser.close().catch(() => undefined)
  }

  await reporter.finish(
    endingOf(stopped),
    stopped ?? 'The requested cycles are done.',
    decider.totals,
  )
  console.log(`\n▸ stopped: ${stopped ?? 'cycles complete'}`)
}

/**
 * What to call the ending.
 *
 * The ceiling is a normal ending and a refusal is not, and the difference
 * shows on the dashboard as the run's status. A rejected runner reported as
 * `BUDGET_REACHED` would have an operator looking at the spend for an answer
 * that is in the token.
 */
function endingOf(stopped: string | null): 'COMPLETED' | 'BUDGET_REACHED' | 'FAILED' {
  if (stopped?.startsWith('budget')) return 'BUDGET_REACHED'
  if (stopped?.startsWith('rejected')) return 'FAILED'
  return 'COMPLETED'
}

interface ScenarioArgs {
  browser: Browser
  persona: PersonaBrief
  decider: Decider
  reporter: Reporter
  cycle: number
}

/** One person, one scenario, to the end or until something stops the run. */
async function runScenario({
  browser,
  persona,
  decider,
  reporter,
  cycle,
}: ScenarioArgs): Promise<string | null> {
  const scenario = scenarioFor(persona, cycle)
  const context = await browser.newContext({
    baseURL: BASE_URL,
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
  })
  const page = await context.newPage()
  watch(page, reporter, persona, scenario)

  reporter.queue({
    kind: 'SCENARIO',
    persona: persona.id,
    scenario,
    summary: `${persona.name}: ${scenario}`,
  })

  const history: string[] = []
  let pending: { text: string; severity: 'blocker' | 'major' | 'minor' | 'info' } | null = null

  try {
    await signIn(page, persona)

    for (let step = 0; step < MAX_STEPS; step += 1) {
      const observed = await observe(page, BASE_URL)

      const { decision, costNanos: spent } = await decider.decide({
        persona,
        scenario,
        observation: observed.observation,
        history: history.slice(-6),
        pendingExpectation: pending?.text ?? null,
      })

      if (pending && decision.previous) {
        reporter.queue({
          kind: 'CHECK',
          persona: persona.id,
          scenario,
          step: `step ${step + 1}`,
          summary: pending.text,
          detail: decision.previous.evidence,
          path: observed.observation.path ?? undefined,
          verdict: decision.previous.held ? 'HELD' : 'FAILED',
          severity: pending.severity,
        })

        if (!decision.previous.held && decision.proposal) {
          reporter.propose({
            targetPath: decision.proposal.targetPath,
            miss: decision.proposal.miss,
            suggestion: decision.proposal.suggestion,
          })
        }
      }

      reporter.queue({
        kind: 'DECISION',
        persona: persona.id,
        scenario,
        step: `step ${step + 1}`,
        summary: decision.doing,
        path: observed.observation.path ?? undefined,
        costMinor: nanosToMinor(spent),
      })

      /*
       * Only ARC's own pages are held to ARC's promises.
       *
       * A link in content can take a persona off the product, and the claim
       * checks look for "safe" and "verified" in the visible text. Running
       * them on somebody else's page would report that page's wording as a
       * failure of non-negotiable 1, which is a false blocker in the feed.
       */
      if (observed.observation.path) {
        claimChecks(
          observed.observation.text,
          observed.observation.path,
          persona,
          scenario,
          reporter,
        )
      }

      const outcome = await act(page, observed, decision.action, BASE_URL)
      reporter.queue({
        kind: outcome.ok ? 'ACTION' : 'PROBLEM',
        persona: persona.id,
        scenario,
        step: `step ${step + 1}`,
        summary: outcome.summary,
        detail: outcome.detail,
        path: observed.observation.path ?? undefined,
      })

      history.push(`${decision.doing} → ${outcome.summary}`)
      pending = decision.expectation ?? null

      const verdict = await reporter.flush(decider.totals)
      if (verdict.stop) return `${verdict.because ?? 'budget'}: ${verdict.reason}`

      if (outcome.finished) break
    }
  } catch (error) {
    reporter.queue({
      kind: 'PROBLEM',
      persona: persona.id,
      scenario,
      summary: 'The scenario ended early',
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    })
  } finally {
    await context.close().catch(() => undefined)
  }

  const verdict = await reporter.flush(decider.totals)
  return verdict.stop ? `${verdict.because ?? 'budget'}: ${verdict.reason}` : null
}

/**
 * The two claims the product promises never to make, checked on every page the
 * personas see, deterministically and for nothing.
 *
 * Not left to the model. These are the product's two load-bearing promises and
 * a judgement about them should not vary between runs — `claims.ts` strips the
 * refusals first, so "it cannot tell you a beach is safe" is not read as a
 * safety claim. The model's own invariant watching is the wider net; this is
 * the one that must never miss.
 */
function claimChecks(
  text: string,
  path: string,
  persona: PersonaBrief,
  scenario: string,
  reporter: Reporter,
): void {
  const safety = safetyClaims(text)
  if (safety.length > 0) {
    reporter.queue({
      kind: 'CHECK',
      persona: persona.id,
      scenario,
      summary: 'No page claims anything is safe',
      detail: describe(safety),
      path,
      verdict: 'FAILED',
      severity: 'blocker',
    })
  }

  const verification = verificationClaims(text)
  if (verification.length > 0) {
    reporter.queue({
      kind: 'NOTE',
      persona: persona.id,
      scenario,
      summary: 'A verification claim is on this page — check it against the admin queue',
      detail: describe(verification),
      path,
    })
  }
}

/** Console errors, page errors and 5xx: what no expectation is looking for. */
function watch(page: Page, reporter: Reporter, persona: PersonaBrief, scenario: string): void {
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    reporter.queue({
      kind: 'PROBLEM',
      persona: persona.id,
      scenario,
      summary: 'Console error',
      detail: message.text().slice(0, 600),
    })
  })
  page.on('pageerror', (error) => {
    reporter.queue({
      kind: 'PROBLEM',
      persona: persona.id,
      scenario,
      summary: 'Page error',
      detail: `${error.name}: ${error.message}`.slice(0, 600),
    })
  })
  page.on('response', (response) => {
    if (response.status() < 500) return
    reporter.queue({
      kind: 'PROBLEM',
      persona: persona.id,
      scenario,
      summary: `${response.status()} from ${response.request().method()}`,
      detail: response.url().slice(0, 300),
    })
  })
}

/**
 * The demo's account switcher.
 *
 * While `ARC_DATA_MODE=demo` the sign-in page lists accounts and issues a
 * session with no credential (ADR-028). That is what makes a persona possible
 * at all, and it is also the reason this runner may only ever point at a demo.
 */
async function signIn(page: Page, persona: PersonaBrief): Promise<void> {
  if (!persona.signInAs) {
    await page.goto(`${BASE_URL}${persona.startPath}`, { timeout: 30_000 })
    return
  }

  await page.goto(`${BASE_URL}/sign-in?next=${encodeURIComponent(persona.startPath)}`, {
    timeout: 30_000,
  })
  const form = page.locator(`form:has(input[value="${persona.signInAs}"])`)
  await form
    .getByRole('button', { name: /sign in/i })
    .click({ timeout: 20_000 })
    .catch(() => undefined)
  await page
    .waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 30_000 })
    .catch(() => undefined)
}

/** The target says what it is, and only one answer is accepted. */
async function preflight(): Promise<void> {
  const response = await fetch(`${BASE_URL}/api/simulation/run`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  })

  if (response.status === 404) {
    fail(
      `${BASE_URL} has no simulation runner configured. SIMULATION_TOKEN is unset there, so the ` +
        'route refuses every caller rather than admitting an anonymous one.',
    )
  }
  if (!response.ok) fail(`${BASE_URL} answered ${response.status} to the preflight.`)

  const body = (await response.json()) as { dataMode?: string }
  if (body.dataMode !== 'demo') {
    fail(
      `${BASE_URL} reports ARC_DATA_MODE=${body.dataMode ?? 'unknown'}. The simulation invents ` +
        'guests, races for inventory and probes refusals; it runs against synthetic data or not ' +
        'at all (ADR-043).',
    )
  }
}

async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : `${response.status}`
    fail(`${path} refused: ${message}`)
  }
  return payload
}

function resolveModel(raw: string | undefined): SimulationModel {
  if (!raw) return DEFAULT_SIMULATION_MODEL
  if (!isSimulationModel(raw)) {
    fail(`Unknown model "${raw}". A model with no price has no ceiling.`)
  }
  return raw
}

/** A ceiling in dollars on the command line, cents everywhere after it. */
function resolveBudget(raw: string | undefined): number {
  const dollars = Number(raw ?? '2')
  if (!Number.isFinite(dollars) || dollars <= 0) fail('--budget must be a positive number of dollars.')
  return Math.round(dollars * 100)
}

function fail(message: string): never {
  console.error(`✖ ${message}`)
  process.exit(1)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
