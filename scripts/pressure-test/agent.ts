/**
 * A persona agent.
 *
 * Each persona is a person with a goal, not a test case. It drives a real
 * browser through the journey that person would take, and records what it
 * observed rather than throwing at the first surprise: a pressure test whose
 * first failure ends the run tells you one thing, and the point of this harness
 * is a readout.
 *
 * So `check()` never throws. It records PASS, FAIL or ERROR with evidence, and
 * the persona carries on. Only `step()` boundaries are allowed to abort, and
 * only the step — the persona moves to its next step.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Browser, BrowserContext, Page } from '@playwright/test'

export type Severity = 'blocker' | 'major' | 'minor' | 'info'

/**
 * What a probe returns. `true` passes; a bare string fails and is the
 * evidence; the object form says which it is explicitly.
 */
export type Verdict = boolean | string | { ok: boolean; evidence?: string }

/** A pass that wants to record what it saw. */
export const held = (evidence: string): Verdict => ({ ok: true, evidence })
export type Status = 'pass' | 'fail' | 'error' | 'skipped'

export interface Finding {
  persona: string
  step: string
  id: string
  severity: Severity
  /** What a person expected to be true. Written as a claim, not as a test name. */
  expectation: string
  status: Status
  /** What was actually seen: page text, a status code, an error message. */
  evidence?: string
  url?: string
  screenshot?: string
  durationMs: number
}

export interface ConsoleProblem {
  persona: string
  step: string
  kind: 'console-error' | 'page-error' | 'request-failed' | 'http-5xx' | 'asset-404'
  detail: string
  url?: string
}

export interface PersonaResult {
  id: string
  name: string
  goal: string
  findings: Finding[]
  problems: ConsoleProblem[]
  notes: string[]
  startedAt: string
  finishedAt: string
}

export interface PersonaModule {
  id: string
  name: string
  goal: string
  run(agent: Agent): Promise<void>
}

export class Agent {
  readonly findings: Finding[] = []
  readonly problems: ConsoleProblem[] = []
  readonly notes: string[] = []
  private currentStep = 'setup'
  private readonly artifactDir: string

  constructor(
    readonly persona: string,
    readonly baseUrl: string,
    readonly page: Page,
    readonly context: BrowserContext,
    artifactDir: string,
  ) {
    this.artifactDir = artifactDir
    this.wire(page)
    context.on('page', (p) => this.wire(p))
  }

  /** Attaches the listeners that catch what no assertion is looking for. */
  private wire(page: Page): void {
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      const text = message.text()
      // React's hydration-diff dump repeats the whole tree; keep the headline.
      this.problems.push({
        persona: this.persona,
        step: this.currentStep,
        kind: 'console-error',
        detail: text.slice(0, 600),
        url: page.url(),
      })
    })
    page.on('pageerror', (error) => {
      this.problems.push({
        persona: this.persona,
        step: this.currentStep,
        kind: 'page-error',
        detail: `${error.name}: ${error.message}`.slice(0, 600),
        url: page.url(),
      })
    })
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? 'unknown'
      // Navigations the persona deliberately aborts are not a product problem.
      if (failure.includes('ERR_ABORTED')) return
      this.problems.push({
        persona: this.persona,
        step: this.currentStep,
        kind: 'request-failed',
        detail: `${request.method()} ${request.url()} — ${failure}`.slice(0, 600),
      })
    })
    page.on('response', (response) => {
      const status = response.status()
      if (status >= 500) {
        this.problems.push({
          persona: this.persona,
          step: this.currentStep,
          kind: 'http-5xx',
          detail: `${status} ${response.request().method()} ${response.url()}`,
        })
        return
      }
      /*
       * A 404 for an asset reaches the console as "Failed to load resource"
       * with no URL, which is unactionable. Named here instead.
       */
      if (status === 404) {
        const kind = response.request().resourceType()
        if (kind === 'document') return
        this.problems.push({
          persona: this.persona,
          step: this.currentStep,
          kind: 'asset-404',
          detail: `404 ${kind} ${response.url()}`,
          url: page.url(),
        })
      }
    })
  }

  note(text: string): void {
    this.notes.push(text)
  }

  /**
   * One leg of the journey. A thrown error ends the step, not the persona:
   * a login that will not complete should not hide what the next page does.
   */
  async step(name: string, body: () => Promise<void>): Promise<void> {
    this.currentStep = name
    const started = Date.now()
    try {
      await body()
    } catch (error) {
      this.findings.push({
        persona: this.persona,
        step: name,
        id: `${name}:step-aborted`,
        severity: 'major',
        expectation: `The journey step "${name}" runs to the end.`,
        status: 'error',
        evidence: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 1200) : String(error),
        url: this.page.url(),
        screenshot: await this.capture(`${name}-aborted`),
        durationMs: Date.now() - started,
      })
    }
  }

  /**
   * An observation with a verdict.
   *
   * The contract, which matters more than it looks: `true` is the only pass by
   * itself. A **string** is a FAILURE carrying its explanation, because that is
   * what a probe naturally produces when it wants to say what it saw instead of
   * what it expected. A pass that wants to record evidence has to say so with
   * `{ ok: true, evidence }`.
   *
   * The first version of this harness treated any string as a pass. It reported
   * 110 of 110 expectations holding, and several of those "passes" carried
   * evidence that said the opposite — including a probe whose own text was "no
   * stated trip total to compare against". A pressure test that cannot fail is
   * not a pressure test, so the ambiguous direction is the failing one.
   */
  async check(
    id: string,
    severity: Severity,
    expectation: string,
    body: () => Promise<Verdict>,
  ): Promise<boolean> {
    const started = Date.now()
    try {
      const outcome = await body()
      const ok = outcome === true || (typeof outcome === 'object' && outcome.ok)
      const evidence =
        typeof outcome === 'string' ? outcome : typeof outcome === 'object' ? outcome.evidence : undefined
      this.findings.push({
        persona: this.persona,
        step: this.currentStep,
        id,
        severity,
        expectation,
        status: ok ? 'pass' : 'fail',
        evidence: evidence?.slice(0, 1200),
        url: this.page.url(),
        screenshot: ok ? undefined : await this.capture(id),
        durationMs: Date.now() - started,
      })
      return ok
    } catch (error) {
      this.findings.push({
        persona: this.persona,
        step: this.currentStep,
        id,
        severity,
        expectation,
        status: 'error',
        evidence: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 1200) : String(error),
        url: this.page.url(),
        screenshot: await this.capture(id),
        durationMs: Date.now() - started,
      })
      return false
    }
  }

  /**
   * Something seen that no expectation can judge — a surface with nothing on it
   * to check, a figure that cannot be reconciled from the page alone. Recorded
   * so the readout says "not reached" rather than quietly counting a pass.
   */
  observe(id: string, expectation: string, what: string): void {
    this.findings.push({
      persona: this.persona,
      step: this.currentStep,
      id,
      severity: 'info',
      expectation,
      status: 'skipped',
      evidence: what,
      url: this.page.url(),
      durationMs: 0,
    })
  }

  skip(id: string, severity: Severity, expectation: string, why: string): void {
    this.findings.push({
      persona: this.persona,
      step: this.currentStep,
      id,
      severity,
      expectation,
      status: 'skipped',
      evidence: why,
      durationMs: 0,
    })
  }

  private async capture(label: string): Promise<string | undefined> {
    try {
      const file = path.join(
        this.artifactDir,
        `${this.persona}-${label.replace(/[^a-z0-9-]+/gi, '-')}.png`,
      )
      await mkdir(path.dirname(file), { recursive: true })
      await this.page.screenshot({ path: file, fullPage: false })
      return file
    } catch {
      return undefined
    }
  }

  /** Full visible text of the current page, lowercased, for a liberal read. */
  async text(): Promise<string> {
    return (await this.page.locator('body').innerText().catch(() => '')).toLowerCase()
  }

  /** A raw request with no session, for probing what an anonymous caller gets. */
  async anonymous(pathname: string): Promise<{ status: number; body: string; finalUrl: string }> {
    const browser = this.context.browser() as Browser
    const fresh = await browser.newContext({ baseURL: this.baseUrl })
    try {
      const response = await fresh.request.get(pathname, { maxRedirects: 0, failOnStatusCode: false })
      return {
        status: response.status(),
        body: (await response.text().catch(() => '')).slice(0, 4000),
        finalUrl: response.headers()['location'] ?? pathname,
      }
    } finally {
      await fresh.close()
    }
  }

  /** A request carrying this persona's session. */
  async asMe(pathname: string): Promise<{ status: number; body: string }> {
    const response = await this.context.request.get(pathname, { failOnStatusCode: false })
    return { status: response.status(), body: (await response.text().catch(() => '')).slice(0, 4000) }
  }

  async signInAsDemo(email: string, next = '/'): Promise<void> {
    await this.page.goto(`${this.baseUrl}/sign-in?next=${encodeURIComponent(next)}`)
    const form = this.page.locator(`form:has(input[value="${email}"])`)
    await form.getByRole('button', { name: /sign in/i }).click({ timeout: 20_000 })
    await this.page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 30_000 })
  }

  /**
   * Waits for text to appear.
   *
   * `isVisible()` answers about *now* and ignores its timeout, so it returned
   * false for copy that an in-flight server action was about to render — which
   * reads as a missing refusal and is not one. `waitFor` waits.
   */
  async visible(selectorText: RegExp | string, timeout = 8_000): Promise<boolean> {
    return this.page
      .getByText(selectorText)
      .first()
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false)
  }

  result(startedAt: string): PersonaResult {
    return {
      id: this.persona,
      name: this.persona,
      goal: '',
      findings: this.findings,
      problems: this.problems,
      notes: this.notes,
      startedAt,
      finishedAt: new Date().toISOString(),
    }
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8')
}
