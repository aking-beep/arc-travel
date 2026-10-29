import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every scheduled path must have a handler for the verb the scheduler uses.
 *
 * All four cron routes once exported `POST` alone, and Vercel invokes a cron
 * job with a `GET`. So every scheduled invocation met a route with no handler
 * for its method, and not one of the four jobs had ever run — holds were never
 * swept, the invariant check never reported, queued mail was never dispatched.
 * Nothing failed; there was simply silence, which is what a healthy scheduled
 * job looks like too. That is why this is a test and not a comment.
 *
 * It reads `vercel.json` rather than a list kept here, so a cron added in the
 * future is covered the day it is scheduled.
 */
const root = join(import.meta.dirname, '..', '..')

interface VercelConfig {
  crons?: Array<{ path: string; schedule: string }>
}

const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as VercelConfig
const crons = config.crons ?? []

describe('the scheduled routes', () => {
  it('are declared at all', () => {
    expect(crons.length).toBeGreaterThan(0)
  })

  it.each(crons.map((cron) => cron.path))('%s exports a GET handler', (path) => {
    const source = readFileSync(join(root, 'src', 'app', path, 'route.ts'), 'utf8')
    expect(source).toMatch(/export (async )?function GET\(/)
  })

  it.each(crons.map((cron) => cron.path))('%s refuses through the shared gate', (path) => {
    const source = readFileSync(join(root, 'src', 'app', path, 'route.ts'), 'utf8')
    // A route with its own copy of the bearer check is a copy that can drift
    // from the others — which is how three operating-window checks disagreed
    // (ADR-029). One gate, one place to change it.
    expect(source).toContain('cronGate(request)')
    expect(source).not.toContain('timingSafeEqual')
  })

  it.each(crons.map((cron) => cron.path))('%s says something when it runs', (path) => {
    const source = readFileSync(join(root, 'src', 'app', path, 'route.ts'), 'utf8')
    // A scheduled job that prints nothing on success cannot be told apart from
    // one that was never invoked — both leave an empty log. `/api/cron/
    // inhabitants` was silent on a clean tick, which is a normal outcome
    // there, and that is why the fix above took a second deployment to
    // confirm. Whatever a run did, including nothing, it says so.
    expect(source).toContain('console.log(')
  })
})
