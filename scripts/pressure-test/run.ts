/**
 * The pressure-test runner.
 *
 * Boots nothing: point it at a running instance with `PRESSURE_BASE_URL`, and
 * it drives each persona through its journey in its own browser context, with
 * its own cookies, in sequence. Sequence rather than parallel is deliberate —
 * the personas share one database, and a run whose findings depend on which
 * persona got to the last seat first is not a readout.
 *
 * The exception is the adversary's own race, which creates its own contexts on
 * purpose.
 *
 *   npm run pressure-test
 *   npm run pressure-test -- --only=adversary,hotel-guest
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { Agent, writeJson, type PersonaModule, type PersonaResult } from './agent.js'
import { writeReport } from './report.js'

import hotelOwner from './personas/hotel-owner.js'
import supplierPartner from './personas/supplier-partner.js'
import hotelGuest from './personas/hotel-guest.js'
import directTraveller from './personas/direct-traveller.js'
import arcAdmin from './personas/arc-admin.js'
import adversary from './personas/adversary.js'

const PERSONAS: PersonaModule[] = [hotelOwner, supplierPartner, hotelGuest, directTraveller, arcAdmin, adversary]

const BASE_URL = (process.env.PRESSURE_BASE_URL ?? 'http://127.0.0.1:3100').replace(/\/$/, '')
const OUT_DIR = process.env.PRESSURE_OUT_DIR ?? path.resolve('pressure-test-output')
/**
 * The browser to launch, following `playwright.config.ts`.
 *
 * Some sandboxes ship a pre-installed Chromium at a different build revision
 * than the one this Playwright version downloads, so that binary is used *when
 * it is there*. Everywhere else this is `undefined` and Playwright uses its own
 * download — the point the config makes, and which this file originally got
 * wrong by hardcoding the sandbox path, so `npm run pressure-test` could not
 * have worked on a normal checkout or in CI.
 */
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

async function main(): Promise<void> {
  const only = argValue('only')?.split(',').map((s) => s.trim()).filter(Boolean)
  const chosen = only ? PERSONAS.filter((p) => only.includes(p.id)) : PERSONAS
  if (chosen.length === 0) throw new Error(`No persona matched --only=${only?.join(',') ?? ''}`)

  console.log(`▸ ARC Stay pressure test against ${BASE_URL}`)
  console.log(`  personas: ${chosen.map((p) => p.id).join(', ')}\n`)

  const browser = await chromium.launch({
    ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
    // Needed wherever this runs as root, which is every container it runs in.
    args: ['--no-sandbox'],
  })

  const results: PersonaResult[] = []
  try {
    for (const persona of chosen) {
      const startedAt = new Date().toISOString()
      process.stdout.write(`▸ ${persona.name}\n`)
      const context = await browser.newContext({
        baseURL: BASE_URL,
        locale: 'en-US',
        viewport: { width: 1280, height: 900 },
      })
      const page = await context.newPage()
      const agent = new Agent(persona.id, BASE_URL, page, context, path.join(OUT_DIR, 'screenshots'))
      try {
        await persona.run(agent)
      } catch (error) {
        agent.note(`The persona ended early: ${error instanceof Error ? error.message : String(error)}`)
      }
      await context.close()

      const result = agent.result(startedAt)
      result.name = persona.name
      result.goal = persona.goal
      results.push(result)

      const fails = result.findings.filter((f) => f.status === 'fail' || f.status === 'error')
      console.log(
        `  ${result.findings.filter((f) => f.status === 'pass').length} held · ${fails.length} did not · ${result.problems.length} console/network problems\n`,
      )
    }
  } finally {
    await browser.close()
  }

  await writeJson(path.join(OUT_DIR, 'findings.json'), { baseUrl: BASE_URL, ranAt: new Date().toISOString(), results })
  const reportPath = await writeReport(OUT_DIR, BASE_URL, results)

  const all = results.flatMap((r) => r.findings)
  const broken = all.filter((f) => f.status === 'fail' || f.status === 'error')
  const blockers = broken.filter((f) => f.severity === 'blocker')
  console.log('─'.repeat(60))
  console.log(`${all.length} expectations · ${all.length - broken.length} held · ${broken.length} did not`)
  console.log(`${blockers.length} of those are blockers`)
  console.log(`report: ${reportPath}`)
  // A pressure test that exits non-zero on a finding cannot be run for a
  // readout, which is what this is for. The readout carries the verdict.
  process.exit(0)
}

await main()
