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
    /*
     * Which departure the guests will actually race, and how much room it has
     * before they do.
     *
     * This spec used to require that at least one guest got through, which is
     * only true if that departure has a place left. Run alone it does; run in
     * the whole suite the earlier journeys have already filled it, so all six
     * are refused and correctly so — the spec failed on its own premise rather
     * than on the product. The experience has several departures and the race
     * takes the first one offered, so the question has to be asked of that one
     * and not of the sum: the others' free places are not places these guests
     * can win.
     */
    const racedSlotId = await firstOfferedSlotId(
      browser,
      `/g/${PORTAL_TOKENS[0]}/experience/${SLUG}`,
    )
    const before = await readSlotState(browser, SLUG)
    const racedBefore = before.slots.find((slot) => slot.id === racedSlotId)
    expect(racedBefore, `the raced departure ${String(racedSlotId)} was not in the slot state`).toBeDefined()
    const roomBefore = Math.max(
      0,
      (racedBefore?.capacity ?? 0) - (racedBefore?.booked ?? 0) - (racedBefore?.held ?? 0),
    )

    const outcomes = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        attemptAdd(browser, `/g/${PORTAL_TOKENS[i % PORTAL_TOKENS.length]}/experience/${SLUG}`, i),
      ),
    )

    const added = outcomes.filter((o) => o === 'added').length
    const refused = outcomes.filter((o) => o === 'refused').length

    console.log(
      `[concurrency] 6 simultaneous adds for a departure with ${String(roomBefore)} free: ` +
        `${String(added)} added, ${String(refused)} refused, ` +
        `${String(outcomes.length - added - refused)} inconclusive`,
    )

    /*
     * Every guest must have been told something. An attempt that ends in
     * neither a basket line nor a refusal is a guest looking at a page that
     * never answered — a 500, or a request that did not come back. That is how
     * a real bug hid here: `inSerializableTransaction` matched only Prisma's
     * own `P2034` and let the driver adapter's serialization error through
     * unretried, so guests got 500s that this spec counted as "inconclusive"
     * and printed rather than failed on.
     */
    expect(
      added + refused,
      `${String(outcomes.length - added - refused)} attempt(s) got no answer at all`,
    ).toBe(outcomes.length)

    // Nobody can take a place that was not there.
    expect(added).toBeLessThanOrEqual(roomBefore)

    /*
     * And if there was room, somebody must have got it. A race where everybody
     * loses while places remain is a deadlock, not safety.
     */
    if (roomBefore > 0) {
      expect(added, `${String(roomBefore)} place(s) were free and nobody got one`).toBeGreaterThan(0)
    }

    /*
     * The real assertion, asked of the slot's own counters. The route already
     * computes `invariantHolds` — the same check
     * `/api/cron/check-invariants` runs in production — and the per-slot
     * numbers are asserted too, so a failure says which slot and by how much
     * rather than just "false".
     */
    const body = await readSlotState(browser, SLUG)

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
 * The departure the race will land on: the first one the page offers, which is
 * the one `attemptAdd` clicks. Read from the form's own hidden field, because
 * guessing it from the slot list means guessing the page's ordering and its
 * rules about which departures get a button at all.
 */
async function firstOfferedSlotId(browser: Browser, href: string): Promise<string | null> {
  const page = await browser.newPage()
  try {
    await page.goto(href)
    return await page
      .locator('form:has(button:text-matches("add to basket", "i")) input[name="slotId"]')
      .first()
      .getAttribute('value')
  } finally {
    await page.close()
  }
}

interface SlotState {
  invariantHolds: boolean
  slots: Array<{ id: string; capacity: number; booked: number; held: number }>
}

/**
 * The slot's own counters, straight from the route that backs
 * `/api/cron/check-invariants`. Read before the race for the room there was,
 * and after it for the invariant.
 */
async function readSlotState(browser: Browser, slug: string): Promise<SlotState> {
  const page = await browser.newPage()
  try {
    const response = await page.request.get(
      `/api/e2e/slot-state?experienceSlug=${encodeURIComponent(slug)}`,
    )
    expect(response.ok(), await response.text()).toBe(true)
    return (await response.json()) as SlotState
  } finally {
    await page.close()
  }
}

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

    /*
     * Either the success message or a refusal, raced rather than waited for so
     * a slow server does not read as a refusal.
     *
     * The refusal pattern covers the serialization-conflict wording too. It
     * used not to, and a refusal the pattern missed was counted "inconclusive"
     * — which looks exactly like the deadlock this file exists to detect.
     */
    const added = page.getByText(/added to your basket/i)
    const refused = page.getByText(
      /filled up|no longer available|capacity|not available|full|being booked by someone else/i,
    )

    const message = await Promise.race([
      added.waitFor({ timeout: 10_000 }).then(() => 'added' as const),
      refused.waitFor({ timeout: 10_000 }).then(() => 'refused' as const),
    ]).catch(() => null)

    if (message !== null) return message

    /*
     * No message, so ask the basket instead.
     *
     * `addToCart` calls `revalidatePath`, so the route remounts and the
     * `useActionState` message is wiped — the habit `CLAUDE.md` records. Under
     * six-way contention the remount usually wins, and four of six attempts
     * were being counted "inconclusive" for a success they had already got.
     * A refusal only ever exists as a message; a success is durable, so this
     * is where to look for it.
     */
    await page.goto(`${href.split('/experience/')[0]}/basket`)
    const inBasket = await page
      .getByRole('heading', { name: /beginner surf lesson/i })
      .first()
      .isVisible()
      .catch(() => false)
    if (inBasket) return 'added'

    const seen = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ')
    console.log(`[concurrency] guest ${String(index)} saw neither: ${seen.slice(0, 200)}`)

    return 'unknown'
  } catch (error) {
    console.log(`[concurrency] guest ${String(index)} threw: ${String(error).slice(0, 200)}`)
    return 'unknown'
  } finally {
    await context.close()
  }
}
