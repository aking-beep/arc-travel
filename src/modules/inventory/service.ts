import { prisma, type Prisma } from '@/lib/db'
import { AppError, capacityUnavailable, conflict, invalid, notFound } from '@/lib/errors'
import { HoldStatus, SlotStatus } from '@/lib/prisma-types'
import { recordAudit } from '@/modules/workflows/audit'

/**
 * Capacity and inventory holds.
 *
 * This is the file where a race condition would cost a real guest a real place
 * on a real boat, so it is the most conservative code in the project.
 *
 * The scheme:
 *   * `AvailabilitySlot.capacity` is the truth. `booked` and `held` are
 *     counters, only ever moved inside a Serializable transaction.
 *   * A hold is taken before checkout and expires. `held` therefore reserves
 *     capacity for someone mid-payment without committing it.
 *   * Expired holds are swept lazily on every read path as well as by an
 *     explicit sweep, so nothing depends on a background job existing.
 *   * Every mutation re-reads the slot inside the transaction and re-checks the
 *     invariant `booked + held <= capacity`. We never trust a value the caller
 *     read a moment ago.
 *
 * Serializable is the right isolation level here despite the cost: two guests
 * taking the last seat concurrently is exactly the anomaly weaker levels allow,
 * and a retried transaction is cheaper than an oversold departure.
 */
export const HOLD_TTL_MINUTES = 15
/** Postgres raises 40001 on a serialization failure; retrying is expected. */
const SERIALIZATION_FAILURE = 'P2034'
const MAX_ATTEMPTS = 5

type Client = Prisma.TransactionClient

/**
 * Runs `fn` in a Serializable transaction, retrying serialization failures with
 * a short backoff. Anything else propagates untouched.
 */
export async function inSerializableTransaction<T>(
  fn: (tx: Client) => Promise<T>,
  attempts = MAX_ATTEMPTS,
): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: 'Serializable',
        timeout: 15_000,
      })
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code !== SERIALIZATION_FAILURE) throw error
      lastError = error
      // 5ms, 10ms, 20ms, 40ms — long enough to let the winner commit.
      await new Promise((resolve) => setTimeout(resolve, 5 * 2 ** attempt))
    }
  }

  throw conflict(
    'That departure is being booked by someone else right now. Try again in a moment.',
    { cause: String(lastError) },
  )
}

export interface SlotAvailability {
  slotId: string
  capacity: number
  booked: number
  held: number
  remaining: number
  status: SlotStatus
  startsAt: Date
}

/**
 * Releases holds whose TTL has passed and returns how many were swept.
 *
 * Called on read paths as well as explicitly: an expiry that only happens when
 * a cron job runs is an expiry that does not happen. The scheduled sweep
 * (`POST /api/cron/sweep-holds`) exists for the holds no read path ever looks
 * at — a slot nobody opens again keeps its phantom `held` for ever, and
 * `placeHold` then refuses places that are free.
 *
 * `limit` bounds one call. Every sweep runs in a single Serializable
 * transaction, so an unbounded one over a neglected database would hold locks
 * across thousands of rows; the scheduled caller passes a batch size and loops.
 */
export async function sweepExpiredHolds(
  options: { slotIds?: string[]; now?: Date; limit?: number } = {},
): Promise<number> {
  const now = options.now ?? new Date()

  const expired = await prisma.inventoryHold.findMany({
    where: {
      status: HoldStatus.ACTIVE,
      expiresAt: { lt: now },
      ...(options.slotIds ? { slotId: { in: options.slotIds } } : {}),
    },
    select: { id: true, slotId: true, quantity: true },
    // Oldest first, so a bounded sweep makes progress rather than re-reading
    // the same page while new expiries arrive.
    orderBy: { expiresAt: 'asc' },
    ...(options.limit ? { take: options.limit } : {}),
  })

  if (expired.length === 0) return 0

  // Counts what was actually swept, not what was found: a concurrent checkout
  // may consume a hold between the query and the transaction, and reporting it
  // as expired would misstate the one number a caller trusts.
  let swept = 0

  await inSerializableTransaction(async (tx) => {
    swept = 0
    for (const hold of expired) {
      // Re-check inside the transaction: a concurrent checkout may have
      // consumed this hold since the query above.
      const current = await tx.inventoryHold.findUnique({
        where: { id: hold.id },
        select: { status: true },
      })
      if (current?.status !== HoldStatus.ACTIVE) continue

      await tx.inventoryHold.update({
        where: { id: hold.id },
        data: { status: HoldStatus.EXPIRED, releasedAt: new Date() },
      })
      await tx.availabilitySlot.update({
        where: { id: hold.slotId },
        data: { held: { decrement: hold.quantity } },
      })
      await reconcileSlotStatus(tx, hold.slotId)
      swept += 1
    }
  })

  return swept
}

/** Keeps `status` consistent with the counters. OPEN/FULL only; never reopens a CLOSED slot. */
async function reconcileSlotStatus(tx: Client, slotId: string): Promise<void> {
  const slot = await tx.availabilitySlot.findUnique({
    where: { id: slotId },
    select: { capacity: true, booked: true, held: true, status: true },
  })
  if (!slot) return
  if (slot.status === SlotStatus.CLOSED || slot.status === SlotStatus.CANCELLED) return

  const isFull = slot.booked + slot.held >= slot.capacity
  const next = isFull ? SlotStatus.FULL : SlotStatus.OPEN
  if (next !== slot.status) {
    await tx.availabilitySlot.update({ where: { id: slotId }, data: { status: next } })
  }
}

export async function getAvailability(slotIds: string[], now = new Date()): Promise<Map<string, SlotAvailability>> {
  if (slotIds.length === 0) return new Map()

  await sweepExpiredHolds({ slotIds, now })

  const slots = await prisma.availabilitySlot.findMany({
    where: { id: { in: slotIds } },
    select: { id: true, capacity: true, booked: true, held: true, status: true, startsAt: true },
  })

  return new Map(
    slots.map((slot) => [
      slot.id,
      {
        slotId: slot.id,
        capacity: slot.capacity,
        booked: slot.booked,
        held: slot.held,
        remaining: Math.max(0, slot.capacity - slot.booked - slot.held),
        status: slot.status,
        startsAt: slot.startsAt,
      },
    ]),
  )
}

export interface HoldResult {
  holdId: string
  slotId: string
  quantity: number
  expiresAt: Date
}

/**
 * Takes a hold on `quantity` places.
 *
 * Idempotent per cart and slot: calling it again for the same pair extends and
 * resizes the existing hold rather than stacking a second one, because a guest
 * changing the number of people in their party should not silently consume two
 * allocations.
 */
export async function placeHold(options: {
  organizationId: string
  slotId: string
  cartId: string
  quantity: number
  now?: Date
  ttlMinutes?: number
}): Promise<HoldResult> {
  const now = options.now ?? new Date()
  const ttl = options.ttlMinutes ?? HOLD_TTL_MINUTES

  if (!Number.isInteger(options.quantity) || options.quantity < 1) {
    throw invalid('Quantity must be a positive whole number.')
  }

  await sweepExpiredHolds({ slotIds: [options.slotId], now })

  return inSerializableTransaction(async (tx) => {
    const slot = await tx.availabilitySlot.findUnique({
      where: { id: options.slotId },
      select: { id: true, capacity: true, booked: true, held: true, status: true, startsAt: true },
    })
    if (!slot) throw notFound('Departure')

    if (slot.status === SlotStatus.CLOSED || slot.status === SlotStatus.CANCELLED) {
      throw capacityUnavailable('That departure is no longer open for booking.')
    }
    if (slot.startsAt.getTime() <= now.getTime()) {
      throw capacityUnavailable('That departure has already started.')
    }

    const existing = await tx.inventoryHold.findFirst({
      where: { slotId: options.slotId, cartId: options.cartId, status: HoldStatus.ACTIVE },
      select: { id: true, quantity: true },
    })

    const alreadyHeldByThisCart = existing?.quantity ?? 0
    const availableToThisCart = slot.capacity - slot.booked - slot.held + alreadyHeldByThisCart

    if (options.quantity > availableToThisCart) {
      throw capacityUnavailable(
        availableToThisCart <= 0
          ? 'That departure is full.'
          : `Only ${availableToThisCart} ${availableToThisCart === 1 ? 'place is' : 'places are'} left on that departure.`,
      )
    }

    const expiresAt = new Date(now.getTime() + ttl * 60_000)
    const delta = options.quantity - alreadyHeldByThisCart

    const hold = existing
      ? await tx.inventoryHold.update({
          where: { id: existing.id },
          data: { quantity: options.quantity, expiresAt },
          select: { id: true },
        })
      : await tx.inventoryHold.create({
          data: {
            organizationId: options.organizationId,
            slotId: options.slotId,
            cartId: options.cartId,
            quantity: options.quantity,
            status: HoldStatus.ACTIVE,
            expiresAt,
          },
          select: { id: true },
        })

    if (delta !== 0) {
      await tx.availabilitySlot.update({
        where: { id: options.slotId },
        data: { held: { increment: delta } },
      })
    }

    await reconcileSlotStatus(tx, options.slotId)

    return { holdId: hold.id, slotId: options.slotId, quantity: options.quantity, expiresAt }
  })
}

export async function releaseHold(options: {
  holdId: string
  reason?: string
}): Promise<void> {
  await inSerializableTransaction(async (tx) => {
    const hold = await tx.inventoryHold.findUnique({
      where: { id: options.holdId },
      select: { id: true, slotId: true, quantity: true, status: true, organizationId: true },
    })
    if (!hold) return
    if (hold.status !== HoldStatus.ACTIVE) return

    await tx.inventoryHold.update({
      where: { id: hold.id },
      data: { status: HoldStatus.RELEASED, releasedAt: new Date() },
    })
    await tx.availabilitySlot.update({
      where: { id: hold.slotId },
      data: { held: { decrement: hold.quantity } },
    })
    await reconcileSlotStatus(tx, hold.slotId)

    await recordAudit(
      {
        organizationId: hold.organizationId,
        actorKind: 'system',
        action: 'inventory.hold.released',
        entityType: 'InventoryHold',
        entityId: hold.id,
        metadata: { slotId: hold.slotId, quantity: hold.quantity, reason: options.reason ?? 'manual' },
      },
      tx,
    )
  })
}

export async function releaseHoldsForCart(cartId: string, reason = 'cart_changed'): Promise<number> {
  const holds = await prisma.inventoryHold.findMany({
    where: { cartId, status: HoldStatus.ACTIVE },
    select: { id: true },
  })
  for (const hold of holds) {
    await releaseHold({ holdId: hold.id, reason })
  }
  return holds.length
}

/**
 * Converts a hold into a booking inside the caller's transaction.
 *
 * Takes `tx` rather than opening its own: consuming a hold and creating the
 * order item have to be the same atomic act, or a crash between them loses
 * either the booking or the capacity.
 */
export async function consumeHold(
  tx: Client,
  options: { holdId: string; orderItemId: string; now?: Date },
): Promise<void> {
  const now = options.now ?? new Date()

  const hold = await tx.inventoryHold.findUnique({
    where: { id: options.holdId },
    select: { id: true, slotId: true, quantity: true, status: true, expiresAt: true },
  })
  if (!hold) throw notFound('Hold')

  if (hold.status !== HoldStatus.ACTIVE) {
    throw conflict('That reservation has already been used or released.')
  }
  if (hold.expiresAt.getTime() < now.getTime()) {
    throw new AppError(
      'HOLD_EXPIRED',
      'Your reservation expired while you were checking out. Nothing has been charged.',
    )
  }

  const slot = await tx.availabilitySlot.findUnique({
    where: { id: hold.slotId },
    select: { capacity: true, booked: true, held: true },
  })
  if (!slot) throw notFound('Departure')

  // The invariant, checked one last time. If this ever fires, something
  // upstream has a bug and we would rather fail the checkout than oversell.
  if (slot.booked + hold.quantity > slot.capacity) {
    throw capacityUnavailable('That departure filled up while you were checking out.')
  }

  await tx.inventoryHold.update({
    where: { id: hold.id },
    data: { status: HoldStatus.CONSUMED, consumedAt: now, orderItemId: options.orderItemId },
  })

  await tx.availabilitySlot.update({
    where: { id: hold.slotId },
    data: { booked: { increment: hold.quantity }, held: { decrement: hold.quantity } },
  })

  await reconcileSlotStatus(tx, hold.slotId)
}

/**
 * Returns capacity to a slot when a confirmed booking is cancelled.
 *
 * Throws rather than clamping when asked to return more than is booked. The
 * previous version silently took `Math.min(quantity, booked)`, which kept the
 * counter non-negative while hiding the fact that something had cancelled the
 * same booking twice — and an under-counted `booked` is worse than a loud
 * failure, because `placeHold` then sells places that do not exist.
 */
export async function returnCapacity(
  tx: Client,
  options: { slotId: string; quantity: number },
): Promise<void> {
  const slot = await tx.availabilitySlot.findUnique({
    where: { id: options.slotId },
    select: { booked: true },
  })
  if (!slot) return

  if (options.quantity > slot.booked) {
    throw conflict(
      `Cannot return ${options.quantity} places to a departure with only ${slot.booked} booked. ` +
        'Something has cancelled this booking twice.',
      { slotId: options.slotId, booked: slot.booked, requested: options.quantity },
    )
  }

  await tx.availabilitySlot.update({
    where: { id: options.slotId },
    data: { booked: { decrement: options.quantity } },
  })
  await reconcileSlotStatus(tx, options.slotId)
}
