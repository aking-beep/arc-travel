import { prisma } from '@/lib/db'
import { CartStatus } from '@/lib/prisma-types'
import { readTripSession } from './book/session'

/**
 * How many departures are in the storefront basket, for the nav badge.
 *
 * Counted rather than carried in the cookie, because the number changes for
 * reasons the cookie never sees: a line removed in another tab, a basket the
 * sweeper expired, a checkout completed elsewhere. A badge showing two things
 * in a basket that holds none is worse than no badge.
 */
export async function countTripItems(): Promise<number> {
  const session = await readTripSession()
  if (!session) return 0

  const cart = await prisma.cart.findUnique({
    where: { id: session.cartId },
    select: { status: true, guestId: true, _count: { select: { items: true } } },
  })
  if (!cart) return 0
  if (cart.status !== CartStatus.OPEN) return 0
  if (cart.guestId !== null) return 0
  return cart._count.items
}
