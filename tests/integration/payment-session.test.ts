import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { money, type Money } from '@/lib/money'
import { resetEnvCache } from '@/lib/env'
import { getIntegrations } from '@/modules/integrations/defaults'
import {
  providerFailed,
  providerOk,
  type PaymentIntent,
  type PaymentsProvider,
  type ProviderResult,
  type RefundResult,
} from '@/modules/integrations/types'
import { addToCart, getOrCreateCart } from '@/modules/commerce/cart'
import { paymentIntentKey, startPaymentSession } from '@/modules/commerce/payment-session'
import { createTenant, resetDatabase, type TenantFixture } from '../helpers/factory'

/**
 * The half of checkout that was missing: producing a payment a guest can
 * actually confirm.
 *
 * Every test here is about a way of handing the browser something it cannot
 * use, or something it should not have. The one that matters most is
 * `does not open a payment against a basket it has not re-read`: the amount
 * the guest confirms has to be the amount this server computed from the rows
 * it just read, because `checkout()` will refuse any order where the two
 * disagree — after the money has moved.
 */
let tenant: TenantFixture
let restore: PaymentsProvider | null = null

async function cartFor(t: TenantFixture): Promise<string> {
  return getOrCreateCart({
    organizationId: t.organizationId,
    propertyId: t.propertyId,
    guestId: t.guestId,
    stayId: t.stayId,
    currency: 'MXN',
  })
}

function usePayments(provider: PaymentsProvider) {
  const integrations = getIntegrations() as { payments: PaymentsProvider }
  restore ??= integrations.payments
  integrations.payments = provider
}

/**
 * A live provider that records what it was asked for.
 *
 * `isLive` is the only thing the service branches on, so this is enough to
 * exercise the whole live path without a network or a Stripe account.
 */
class RecordingProvider implements PaymentsProvider {
  readonly name = 'recording'
  readonly isLive = true
  readonly calls: Array<{ idempotencyKey: string; amount: Money; orderReference: string }> = []

  constructor(
    private readonly overrides: Partial<PaymentIntent> & { fail?: string } = {},
  ) {}

  async createIntent(input: {
    idempotencyKey: string
    amount: Money
    orderReference: string
    description: string
  }): Promise<ProviderResult<PaymentIntent>> {
    this.calls.push({
      idempotencyKey: input.idempotencyKey,
      amount: input.amount,
      orderReference: input.orderReference,
    })
    if (this.overrides.fail) return providerFailed(this.name, this.overrides.fail)
    return providerOk(this.name, {
      reference: `pi_${this.calls.length}`,
      status: 'requires_confirmation' as const,
      amount: input.amount,
      isSimulated: false,
      clientSecret: `pi_${this.calls.length}_secret_abc`,
      ...this.overrides,
    })
  }

  async retrieveIntent(): Promise<ProviderResult<PaymentIntent>> {
    return providerFailed(this.name, 'not_used_here')
  }

  async refund(input: { amount: Money }): Promise<ProviderResult<RefundResult>> {
    return providerOk(this.name, {
      reference: 'rf_1',
      amount: input.amount,
      isSimulated: false,
    })
  }
}

beforeEach(async () => {
  await resetDatabase()
  tenant = await createTenant({ capacity: 6, priceMinor: 95_000 })
  /*
   * `ARC_DATA_MODE` is `demo` in the test environment, and the service refuses
   * a live provider in demo mode. The live tests want the live path, so the
   * mode is lifted — and the env cache dropped, because `getEnv()` memoises
   * and a mutated `process.env` is otherwise read once and never again.
   */
  process.env.ARC_DATA_MODE = 'pilot'
  resetEnvCache()
})

afterEach(() => {
  if (restore) (getIntegrations() as { payments: PaymentsProvider }).payments = restore
  restore = null
  process.env.ARC_DATA_MODE = 'demo'
  resetEnvCache()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('startPaymentSession, simulated', () => {
  it('reports that no payment is needed rather than inventing a secret', async () => {
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 2 })

    const session = await startPaymentSession({ cartId, guestId: tenant.guestId })

    expect(session.isSimulated).toBe(true)
    // The simulated provider's `createIntent` succeeds unconditionally, so a
    // service that called it here would hand the browser a null secret and a
    // payment form that renders and then does nothing.
    expect(session.clientSecret).toBeNull()
    expect(session.publishableKey).toBeNull()
    expect(session.paymentReference).toBeNull()
    // The total is still computed, because the caller shows it either way.
    expect(session.amountMinor).toBe(190_000)
  })
})

describe('startPaymentSession, live', () => {
  it('opens a payment for the amount it computed from the basket rows', async () => {
    const provider = new RecordingProvider()
    usePayments(provider)

    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 3 })

    const session = await startPaymentSession({ cartId, guestId: tenant.guestId })

    expect(session.isSimulated).toBe(false)
    expect(session.clientSecret).toBe('pi_1_secret_abc')
    expect(session.paymentReference).toBe('pi_1')
    expect(session.amountMinor).toBe(285_000)
    expect(provider.calls[0]?.amount).toEqual(money(285_000, 'MXN'))
    // Not an order reference: no order exists yet, and will not until the
    // payment has succeeded (ADR-026). The cart id is what reconciliation
    // needs to find an intent with no order behind it.
    expect(provider.calls[0]?.orderReference).toBe(`cart:${cartId}`)
  })

  it('re-uses one intent across renders of an unchanged basket', async () => {
    const provider = new RecordingProvider()
    usePayments(provider)

    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })

    const first = await startPaymentSession({ cartId, guestId: tenant.guestId })
    const second = await startPaymentSession({ cartId, guestId: tenant.guestId })

    /*
     * The basket page is a Server Component and re-renders on every
     * revalidate. A random key per render would leave a trail of abandoned
     * intents at Stripe and — the part that matters — let one guest hold two
     * confirmable secrets for the same basket at once.
     */
    expect(provider.calls).toHaveLength(2)
    expect(provider.calls[0]?.idempotencyKey).toBe(provider.calls[1]?.idempotencyKey)
    expect(first.amountMinor).toBe(second.amountMinor)
  })

  it('asks for a different payment once the basket changes', async () => {
    const provider = new RecordingProvider()
    usePayments(provider)

    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })
    const first = await startPaymentSession({ cartId, guestId: tenant.guestId })

    await addToCart({ cartId, slotId: tenant.slotId, quantity: 2 })
    const second = await startPaymentSession({ cartId, guestId: tenant.guestId })

    // The amount is part of what the guest is confirming, so a different
    // amount is a different payment.
    expect(second.amountMinor).not.toBe(first.amountMinor)
    expect(provider.calls[0]?.idempotencyKey).not.toBe(provider.calls[1]?.idempotencyKey)
  })

  it('refuses when the provider confirms an amount other than the one asked for', async () => {
    // Stripe is the authority on what it was asked to charge. If its answer
    // and ours disagree, the guest is being shown one number and asked to
    // confirm another.
    usePayments(new RecordingProvider({ amount: money(1, 'MXN') }))

    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })

    await expect(startPaymentSession({ cartId, guestId: tenant.guestId })).rejects.toMatchObject({
      code: 'PAYMENT_UNAVAILABLE',
    })
  })

  it('refuses an intent the browser cannot confirm', async () => {
    usePayments(new RecordingProvider({ clientSecret: null }))

    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })

    await expect(startPaymentSession({ cartId, guestId: tenant.guestId })).rejects.toMatchObject({
      code: 'PAYMENT_UNAVAILABLE',
    })
  })

  it('refuses a live provider that reports a simulated payment', async () => {
    // A wiring error, and the wrong place to find it out is a guest's card.
    usePayments(new RecordingProvider({ isSimulated: true }))

    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })

    await expect(startPaymentSession({ cartId, guestId: tenant.guestId })).rejects.toMatchObject({
      code: 'INTERNAL',
    })
  })

  it('reports a provider failure as unavailable, with the provider’s own reason', async () => {
    usePayments(new RecordingProvider({ fail: 'stripe_api_key_expired' }))

    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })

    await expect(startPaymentSession({ cartId, guestId: tenant.guestId })).rejects.toMatchObject({
      code: 'PAYMENT_UNAVAILABLE',
      details: { reason: 'stripe_api_key_expired' },
    })
  })

  it('refuses a live provider while the build is in demo mode', async () => {
    process.env.ARC_DATA_MODE = 'demo'
    resetEnvCache()
    usePayments(new RecordingProvider())

    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })

    // The fourth refusal of this combination, after getEnv, getIntegrations
    // and checkout. This is now a path that can mint a chargeable credential.
    await expect(startPaymentSession({ cartId, guestId: tenant.guestId })).rejects.toMatchObject({
      code: 'DEMO_MODE_BLOCKED',
    })
  })
})

describe('startPaymentSession, ownership', () => {
  it('will not open a payment for another guest’s basket', async () => {
    usePayments(new RecordingProvider())
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })

    const other = await prisma.guest.create({
      data: {
        organizationId: tenant.organizationId,
        propertyId: tenant.propertyId,
        firstName: 'Someone',
        lastName: 'Else',
        email: 'someone.else@example.test',
      },
      select: { id: true },
    })

    /*
     * A portal token is a bearer credential and a cart id is a uuid in a
     * server-rendered page. The ownership check is in the service, scoped by
     * the guest the token resolved to — and the answer is `notFound`, not
     * `forbidden`, so the difference cannot be used to discover which cart ids
     * exist.
     */
    await expect(startPaymentSession({ cartId, guestId: other.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('refuses an empty basket', async () => {
    usePayments(new RecordingProvider())
    const cartId = await cartFor(tenant)

    await expect(startPaymentSession({ cartId, guestId: tenant.guestId })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
  })
})

describe('paymentIntentKey', () => {
  it('does not put the cart id in a third party’s logs', () => {
    const key = paymentIntentKey({ cartId: 'cart-abc-123', totalMinor: 1000, currency: 'MXN' })
    expect(key).not.toContain('cart-abc-123')
    expect(key).toMatch(/^arc-cart-[0-9a-f]{32}$/)
  })

  it('is stable for the same basket at the same total, and differs otherwise', () => {
    const base = { cartId: 'c1', totalMinor: 1000, currency: 'MXN' }
    expect(paymentIntentKey(base)).toBe(paymentIntentKey({ ...base }))
    expect(paymentIntentKey(base)).not.toBe(paymentIntentKey({ ...base, totalMinor: 1001 }))
    expect(paymentIntentKey(base)).not.toBe(paymentIntentKey({ ...base, currency: 'USD' }))
    expect(paymentIntentKey(base)).not.toBe(paymentIntentKey({ ...base, cartId: 'c2' }))
  })
})
