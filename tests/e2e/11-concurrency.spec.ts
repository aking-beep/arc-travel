import { expect, test, type Browser } from '@playwright/test'

import { GUEST_PORTAL_TOKENS } from './helpers'

/*
 * Three real guests, two attempts each. A guest adding twice is a legitimate
 * race too, and using only one token would make every attempt the same basket.
 */
const PORTAL_TOKENS = [
  GUEST_PORTAL_TOKENS.completedIntake,
  GUEST_PORTAL_TOKENS.advancedSurfer,
  GUEST_PORTAL_TOKENS.arrivingToday,
] as const

/**
 * Can concurrent guests oversell a departure?
 *
 * `tests/integration/inventory.test.ts` races `placeHold` and proves the
 * Serializable transaction holds at the service level. This asks the same
 * question of the deployed stack: six real browsers, the real server action,
 * the real connection pool, a production build.
 *
 * The distinction is not academic. A transaction-mode pooler (PgBouncer, or
 * Supabase's Supavisor on 6543) hands a different backend to each statement,
 * which breaks interactive transactions while passing every integration test —
 * those run against a direct connection. This is the test that would catch it.
 * See the pooling note in `docs/deployment.md`.
 *
 * The expected outcome is **not** that every add succeeds. It is that
 * `booked + held` never exceeds `capacity` and the surplus attempts are
 * refused. A race where everyone wins is the bug.
 */
test.describe('concurrency', () => {
  test.slow()

  test('six simultaneous guests cannot oversell one departure', async ({ browser }) => {
    /*
     * A known experience slug rather than one scraped from the explore page.
     * The specs already navigate this way (`04-guest-checkout`), and a race
     * test whose first act is to guess at a link selector reports
     * "inconclusive" when the selector is wrong — which looks exactly like a
     * deadlock and is not one. It was inconclusive on the first run for
     * precisely that reason.
     */
    const SLUG = 'carrizalillo-beginner-surf-lesson'

    /*
     * Six independent contexts, so six independent sessions and six independent
     * baskets. Separate contexts rather than separate pages: pages in one
     * context share cookies, which would make this one guest clicking fast
     * rather than six guests arriving at once.
     */
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        attemptAdd(browser, `/g/${PORTAL_TOKENS[i % PORTAL_TOKENS.length]}/experience/${SLUG}`, i),
      ),
    )

    const added = outcomes.filter((o) => o === 'added').length
    const refused = outcomes.filter((o) => o === 'refused').length

    console.log(
      `[concurrency] 6 simultaneous adds: ${String(added)} added, ${String(refused)} refused, ` +
        `${String(outcomes.length - added - refused)} inconclusive`,
    )

    // At least one guest must get through — a race where everybody loses is a
    // deadlock, not safety.
    expect(added).toBeGreaterThan(0)

    /*
     * The real assertion. Whatever the split, the slot's own counters must
     * still satisfy the invariant: this is the same check
     * `/api/cron/check-invariants` runs in production, asked here of a slot
     * that has just been raced.
     */
    /*
     * The real assertion, asked of the slot's own counters. The route already
     * computes `invariantHolds` — the same check
     * `/api/cron/check-invariants` runs in production — and the per-slot
     * numbers are asserted too, so a failure says which slot and by how much
     * rather than just "false".
     */
    const verifier = await browser.newPage()
    const response = await verifier.request.get(
      `/api/e2e/slot-state?experienceSlug=${encodeURIComponent(SLUG)}`,
    )
    expect(response.ok(), await response.text()).toBe(true)
    const body = (await response.json()) as {
      invariantHolds: boolean
      slots: Array<{ id: string; capacity: number; booked: number; held: number }>
    }
    await verifier.close()

    expect(body.slots.length).toBeGreaterThan(0)
    for (const slot of body.slots) {
      expect(
        slot.booked + slot.held,
        `slot ${slot.id}: booked ${String(slot.booked)} + held ${String(slot.held)} must not ` +
          `exceed capacity ${String(slot.capacity)}`,
      ).toBeLessThanOrEqual(slot.capacity)
      expect(slot.booked).toBeGreaterThanOrEqual(0)
      expect(slot.held).toBeGreaterThanOrEqual(0)
    }
    expect(body.invariantHolds).toBe(true)
  })
})

/**
 * One guest's attempt. Returns what happened rather than asserting, because
 * both outcomes are correct and only the aggregate is interesting.
 */
async function attemptAdd(
  browser: Browser,
  href: string,
  index: number,
): Promise<'added' | 'refused' | 'unknown'> {
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto(href)
    const add = page.getByRole('button', { name: /add to basket/i }).first()
    if (!(await add.isVisible().catch(() => false))) return 'unknown'

    await add.click()

    // Either the success message or a refusal. `Promise.race` rather than a
    // fixed wait, so a slow server does not read as a refusal.
    const added = page.getByText(/added to your basket/i)
    const refused = page.getByText(/filled up|no longer available|capacity|not available/i)

    const result = await Promise.race([
      added.waitFor({ timeout: 20_000 }).then(() => 'added' as const),
      refused.waitFor({ timeout: 20_000 }).then(() => 'refused' as const),
    ]).catch(() => 'unknown' as const)

    return result
  } catch {
    return 'unknown'
  } finally {
    await context.close()
    void index
  }
}
