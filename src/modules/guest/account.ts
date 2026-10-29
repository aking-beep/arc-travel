import { prisma, type Prisma } from '@/lib/db'
import { conflict, invalid, notFound } from '@/lib/errors'
import { hashPassword } from '@/lib/password'
import { assertWithinRateLimit, rateLimitSubject } from '@/lib/rate-limit'
import { daysBetween, toDateKey, toLocalDateKey, type DateKey } from '@/lib/dates'
import { fromPrismaLocale, type AppLocale } from '@/lib/i18n'
import { OrderStatus, Role, StayKind, StayStatus } from '@/lib/prisma-types'
import { recordAudit } from '@/modules/workflows/audit'
import { PORTAL_GRACE_DAYS } from './portal'
import { claimStaySchema, guestSignUpSchema, portalAccountSignUpSchema } from './schemas'

/**
 * Guest accounts.
 *
 * Until this existed a guest's only way in was the QR code at the front desk:
 * `/g/<token>` and nothing else. That token is a bearer credential scoped to
 * one stay (ADR-035), which makes it the right thing to hand over at a desk
 * and the wrong thing to be someone's only way back to their own booking — it
 * cannot be recovered when the photograph of the QR code is lost, it says
 * nothing about who is holding it, and it shows one stay even when the person
 * has three.
 *
 * So a guest may now hold an account. Three rules shape it:
 *
 *   1. **An account is claimed, never asserted.** Creating one proves nothing
 *      on its own. What links a person to a booking is the booking reference
 *      *and* the address the property recorded against it — the two together,
 *      because the reference alone is printed on paper that gets left in
 *      rooms, and the address alone is something a stranger may know. ARC
 *      never infers the link from a matching address: a hotel typing the wrong
 *      email must not hand a stranger a guest's itinerary.
 *   2. **A refusal says nothing.** Wrong reference, wrong address, cancelled
 *      stay and already-claimed stay all return one message. Otherwise this
 *      form answers "is STAY-7K4M-QX2P a real booking, and whose?".
 *   3. **The account is an index, not a second portal.** It lists the person's
 *      stays and summarises each one, and hands off to `/g/<token>` for
 *      anything that changes something. One authorisation boundary for the
 *      guest surface rather than two. See ADR-039.
 */

/** Signing up is cheap for us and should not be free to automate. */
const GUEST_SIGN_UPS_PER_CALLER = 10
const GUEST_SIGN_UP_WINDOW_SECONDS = 3_600

/**
 * Claim attempts, per caller and per reference.
 *
 * A reference is eight characters from a 31-character alphabet, so guessing
 * one is not the threat; checking a list of references harvested from paper
 * confirmations is. Both buckets are deliberately tight — a guest reading off
 * their own confirmation needs two or three tries at most.
 */
const CLAIMS_PER_CALLER = 10
const CLAIMS_PER_REFERENCE = 5
const CLAIM_WINDOW_SECONDS = 900

/** Bumped when the guest terms change, and recorded with each acceptance. */
export const GUEST_TERMS_VERSION = '2026-10-26'

/**
 * Deliberately identical for every way a claim can fail.
 *
 * It names both possibilities — no match, or already claimed — without saying
 * which, because saying which would answer "is `STAY-7K4M-QX2P` a real
 * booking, and whose?". Naming both is what stops the message being
 * misleading to the person it most often reaches: somebody who signed up last
 * week and forgot.
 */
const claimRefused = () =>
  invalid(
    'That booking reference and email do not match a current booking, or it has already been claimed. Check your confirmation, sign in if you already have an account, or ask the property.',
  )

/**
 * The forms a guest might type their reference in.
 *
 * References are minted as `STAY-7K4M-QX2P` (`src/lib/ids.ts`) and read off a
 * printed confirmation, so people drop the hyphens. The schema has already
 * upper-cased and de-spaced the input; this puts the hyphens back when the
 * result is the shape a reference actually has, and otherwise leaves it alone.
 */
export function referenceCandidates(normalised: string): string[] {
  const candidates = new Set<string>([normalised])

  const compact = normalised.replace(/-/g, '')
  candidates.add(compact)

  const shaped = /^([A-Z]{2,8})([A-Z0-9]{4})([A-Z0-9]{4})$/.exec(compact)
  if (shaped) candidates.add(`${shaped[1]}-${shaped[2]}-${shaped[3]}`)

  return [...candidates]
}

export interface GuestClaimInput {
  reference: string
  email: string
}

/**
 * Finds the one stay a reference and an address may claim, or null.
 *
 * The ownership predicate is in the `where` clause rather than in a check
 * afterwards, which is what `CLAUDE.md` asks of anything on the guest surface
 * that accepts a client-supplied identifier. A cancelled or no-show stay is
 * excluded here for the same reason `resolvePortalContext` excludes it: it is
 * not a booking any more.
 */
export interface ClaimableStay {
  id: string
  guestId: string
  organizationId: string
  guestEmail: string
  /**
   * The user the guest record already points at, if any.
   *
   * Usually null. It is *not* null for a record the front desk created through
   * `createStay`, or for the demo seed, both of which make a `User` with no
   * credentials so the guest has an identity to act under. A passwordless user
   * is a placeholder, not an account anybody holds — see `holdsAccount`.
   */
  guestUser: { id: string; email: string; hasPassword: boolean } | null
}

async function findClaimableStay(
  input: GuestClaimInput,
  now: Date,
): Promise<ClaimableStay | null> {
  const stay = await prisma.stay.findFirst({
    where: {
      reference: { in: referenceCandidates(input.reference) },
      status: { notIn: [StayStatus.CANCELLED, StayStatus.NO_SHOW] },
      guest: { email: { equals: input.email, mode: 'insensitive' } },
    },
    select: {
      id: true,
      checkOut: true,
      organizationId: true,
      guest: {
        select: {
          id: true,
          email: true,
          user: { select: { id: true, email: true, passwordHash: true } },
        },
      },
    },
  })
  if (!stay) return null

  // A booking stops being claimable when its portal would have expired
  // anyway. Claiming a stay from last March to read a receipt is a different
  // feature from claiming the one you are about to arrive for, and this is the
  // boundary the rest of the guest surface already draws.
  if (daysBetween(toDateKey(stay.checkOut), toDateKey(now)) > PORTAL_GRACE_DAYS) return null

  const user = stay.guest.user

  return {
    id: stay.id,
    guestId: stay.guest.id,
    organizationId: stay.organizationId,
    guestEmail: stay.guest.email,
    guestUser: user
      ? { id: user.id, email: user.email, hasPassword: Boolean(user.passwordHash) }
      : null,
  }
}

/**
 * Whether somebody actually holds the account a guest record points at.
 *
 * A `User` with no `passwordHash` is nobody's account: nothing can sign into
 * it outside demo mode, and it exists so the front desk could give the guest
 * an identity before the guest had one. Treating that placeholder as "already
 * claimed" would mean every guest the desk ever entered — and every guest in
 * the demo seed — could never create an account for themselves, which is the
 * feature.
 *
 * Taking one over is the same handover an invitation performs
 * (`acceptInvitationFor`): the addresses must match, and ADR-021's rule about
 * never rewriting a stranger's profile holds because the claim has already
 * proved the booking.
 */
export function holdsAccount(stay: ClaimableStay): boolean {
  if (!stay.guestUser) return false
  if (stay.guestUser.hasPassword) return true
  // A placeholder for a *different* address is not ours to take over.
  return stay.guestUser.email.toLowerCase() !== stay.guestEmail.toLowerCase()
}

async function guardClaim(
  options: { clientKey?: string | null; reference: string; now: Date },
): Promise<void> {
  if (options.clientKey) {
    await assertWithinRateLimit({
      bucket: `guest-claim:caller:${rateLimitSubject(options.clientKey)}`,
      limit: CLAIMS_PER_CALLER,
      windowSeconds: CLAIM_WINDOW_SECONDS,
      message: 'Too many attempts. Wait a few minutes and try again.',
      now: options.now,
    })
  }

  await assertWithinRateLimit({
    bucket: `guest-claim:ref:${rateLimitSubject(options.reference.replace(/-/g, ''))}`,
    limit: CLAIMS_PER_REFERENCE,
    windowSeconds: CLAIM_WINDOW_SECONDS,
    message: 'Too many attempts for that booking. Wait a few minutes and try again.',
    now: options.now,
  })
}

export interface GuestRegistrationResult {
  userId: string
  guestId: string
  stayId: string
  organizationId: string
}

/**
 * The select a claim needs to judge whether a user row is a placeholder.
 *
 * Existence is not the question, and neither is `passwordHash` alone. A
 * credential-free `User` that carries a privileged membership or an invitation
 * is not nobody's account — it is an account ARC staged for a *named* person
 * to take over by another route. `invitePartner` creates exactly that shape: a
 * passwordless contact with a `SUPPLIER` membership and an open invitation.
 * Absorbing one would hand a guest that partner's memberships, their portal
 * and their profile, which is the cross-tenant write ADR-021 exists to forbid.
 *
 * `GUEST` is excluded deliberately, and is the whole reason this asks about the
 * role rather than counting rows: a guest placeholder carries a `GUEST`
 * membership already — the seed and the factory both give it one — so counting
 * every membership would refuse exactly the handover this feature exists for.
 * A `GUEST` membership confers nothing the claim is not itself establishing.
 */
export const PLACEHOLDER_SELECT = {
  id: true,
  passwordHash: true,
  memberships: { where: { role: { not: Role.GUEST } }, select: { id: true }, take: 1 },
  invitations: { select: { id: true }, take: 1 },
} as const

export interface PlaceholderCandidate {
  passwordHash: string | null
  /** Already filtered to the privileged roles by `PLACEHOLDER_SELECT`. */
  memberships: { id: string }[]
  invitations: { id: string }[]
}

/**
 * Whether this user row belongs to somebody already.
 *
 * True means a claim must be refused rather than take the row over: either a
 * password exists, or somebody else is expected to set one.
 */
export function isSpokenFor(user: PlaceholderCandidate): boolean {
  return user.passwordHash !== null || user.memberships.length > 0 || user.invitations.length > 0
}

/**
 * Creates or takes over the account for a proved claim, inside a transaction.
 *
 * Both sign-up paths end here, because the interesting part is the same for
 * both and getting it wrong twice would be two bugs. Three cases:
 *
 *   * **A placeholder the guest record points at**, created by the front desk
 *     or the seed with no credentials and the same address. Set the password
 *     on it. A handover, not a new account: the person keeps the identity
 *     their bookings already point at.
 *   * **An orphan placeholder at the same address**, left behind when an
 *     earlier claim at another property repointed its guest record away from
 *     it. Nothing can sign into it and `User.email` is unique, so refusing
 *     here would mean refusing that address forever — there is no password
 *     reset to recover it with. Take it over on the same terms, but only once
 *     `isSpokenFor` says nobody else has a claim on it.
 *   * **No user.** Create one.
 *
 * Every write is conditional on what was read: `passwordHash: null` on the
 * user, and the owner the `ClaimableStay` carried on the guest record. That
 * record was read *outside* this transaction, so its owner is a hypothesis
 * rather than a fact — an unconditional write would let a concurrent
 * `claimStayForAccount` and this function each overwrite the other, which is
 * the race the whole claim exists to close. A lost race is a conflict, never
 * an overwrite.
 */
export async function establishAccount(
  tx: Prisma.TransactionClient,
  stay: ClaimableStay,
  input: { name: string; email: string; passwordHash: string },
  claimedWith: string[],
  termsAccepted: boolean,
): Promise<string> {
  // The placeholder this claim may take over, re-read inside the transaction.
  // Either the user the guest record points at, or — when it points at nobody
  // — an orphan at the same address.
  const placeholder = await tx.user.findUnique({
    where: stay.guestUser ? { id: stay.guestUser.id } : { email: input.email },
    select: PLACEHOLDER_SELECT,
  })

  let userId: string
  let tookOver: boolean

  if (placeholder && isSpokenFor(placeholder)) {
    throw conflict('That email already has an ARC account. Sign in instead.')
  } else if (placeholder) {
    const taken = await tx.user.updateMany({
      where: { id: placeholder.id, passwordHash: null },
      data: { passwordHash: input.passwordHash, name: input.name },
    })
    // Somebody set a password on it between the read above and here.
    if (taken.count !== 1) {
      throw conflict('This booking already belongs to an ARC account. Sign in instead.')
    }
    userId = placeholder.id
    tookOver = true
  } else {
    let created
    try {
      created = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash: input.passwordHash },
        select: { id: true },
      })
    } catch (error) {
      // Lost the race to claim the address between the read above and here.
      if ((error as { code?: string }).code === 'P2002') {
        throw conflict('That email already has an ARC account. Sign in instead.')
      }
      throw error
    }
    userId = created.id
    tookOver = false
  }

  // The owner the guest record is allowed to still have: nobody, or the
  // placeholder we just took over. Anything else means a concurrent claim won
  // it, and this one loses rather than overwriting theirs.
  const linked = await tx.guest.updateMany({
    where: {
      id: stay.guestId,
      ...(stay.guestUser ? { OR: [{ userId: null }, { userId: stay.guestUser.id }] } : { userId: null }),
    },
    data: { userId },
  })
  if (linked.count !== 1) throw claimRefused()

  await recordAudit(
    {
      organizationId: stay.organizationId,
      actor: {
        userId,
        email: input.email,
        name: input.name,
        isPlatformAdmin: false,
        memberships: [],
      },
      actorKind: 'guest',
      action: 'guest.account.registered',
      entityType: 'Guest',
      entityId: stay.guestId,
      // Field names, not values: a guest's address and reference are their
      // data, and what the trail needs to record is that the claim happened.
      metadata: {
        stayId: stay.id,
        claimedWith,
        tookOverPlaceholder: tookOver,
        acceptedTerms: termsAccepted,
        termsVersion: GUEST_TERMS_VERSION,
      },
    },
    tx,
  )

  return userId
}

/**
 * Creates a guest account from the cold form, and links it to the booking it
 * was proved with.
 *
 * The account and the link are one transaction. An account with no booking is
 * a dead end the person cannot fix themselves — they would sign in to an empty
 * page with no way to claim the stay they just proved — and a link with no
 * account is unreachable.
 *
 * No session is established here. A domain module that set a cookie could not
 * be called from a test, a script or anywhere but a request.
 */
export async function registerGuestAccount(
  raw: unknown,
  options: { clientKey?: string | null; now?: Date } = {},
): Promise<GuestRegistrationResult> {
  const input = guestSignUpSchema.parse(raw)
  const now = options.now ?? new Date()

  if (options.clientKey) {
    await assertWithinRateLimit({
      bucket: `guest-sign-up:caller:${rateLimitSubject(options.clientKey)}`,
      limit: GUEST_SIGN_UPS_PER_CALLER,
      windowSeconds: GUEST_SIGN_UP_WINDOW_SECONDS,
      message: 'Too many sign-ups from here. Try again later.',
      now,
    })
  }
  await guardClaim({ clientKey: options.clientKey, reference: input.reference, now })

  // The booking first, because whether the address is "already taken" depends
  // on it: a placeholder account the front desk made for this very guest is
  // theirs to take over, and an unrelated account at the same address is not.
  const stay = await findClaimableStay({ reference: input.reference, email: input.email }, now)
  if (!stay) throw claimRefused()
  // Somebody already holds this booking. Same message as a wrong reference:
  // whether a booking has been claimed is not this form's to say.
  if (holdsAccount(stay)) throw claimRefused()

  if (!stay.guestUser) {
    // Checked before the transaction for a readable message, and again inside
    // it, which is what actually makes it safe. A *passwordless* user at this
    // address is not on its own a reason to refuse — `establishAccount` takes
    // a placeholder over — so only a row somebody has a claim on stops the
    // claim here.
    const taken = await prisma.user.findUnique({
      where: { email: input.email },
      select: PLACEHOLDER_SELECT,
    })
    if (taken && isSpokenFor(taken)) {
      throw conflict(
        'That email already has an ARC account. Sign in instead, and add this booking from your account.',
      )
    }
  }

  const passwordHash = await hashPassword(input.password)

  const userId = await prisma.$transaction((tx) =>
    establishAccount(
      tx,
      stay,
      { name: input.name, email: input.email, passwordHash },
      ['reference', 'email'],
      true,
    ),
  )

  return {
    userId,
    guestId: stay.guestId,
    stayId: stay.id,
    organizationId: stay.organizationId,
  }
}

/**
 * Creates a guest account from inside the portal.
 *
 * The caller has already resolved a portal token, which *is* the proof of the
 * booking — so this asks for a name and a password and nothing else. The
 * address is the one the property recorded and the stay is the one the token
 * names: neither is a client-supplied value here, which is why there is no
 * reference to rate-limit and no uniform refusal to give.
 *
 * It is the funnel that actually works. The cold form needs the guest to find
 * a reference and remember which address the hotel holds; a guest standing in
 * the room with the QR code open has both already.
 */
export async function registerGuestAccountFromPortal(
  context: { stayReference: string; guestEmail: string },
  raw: unknown,
  options: { clientKey?: string | null; now?: Date } = {},
): Promise<{ userId: string }> {
  const input = portalAccountSignUpSchema.parse(raw)
  const now = options.now ?? new Date()

  if (options.clientKey) {
    await assertWithinRateLimit({
      bucket: `guest-sign-up:caller:${rateLimitSubject(options.clientKey)}`,
      limit: GUEST_SIGN_UPS_PER_CALLER,
      windowSeconds: GUEST_SIGN_UP_WINDOW_SECONDS,
      message: 'Too many sign-ups from here. Try again later.',
      now,
    })
  }

  // Re-found rather than trusted: the caller passes what the resolved token
  // said, and this re-derives the same ClaimableStay the cold form works on,
  // so both paths share one set of rules about cancelled and expired stays.
  const email = context.guestEmail.trim().toLowerCase()
  const stay = await findClaimableStay({ reference: context.stayReference, email }, now)
  if (!stay) throw notFound('Stay')
  if (holdsAccount(stay)) {
    throw conflict('This booking already belongs to an ARC account. Sign in instead.')
  }

  if (!stay.guestUser) {
    const taken = await prisma.user.findUnique({ where: { email }, select: PLACEHOLDER_SELECT })
    if (taken && isSpokenFor(taken)) {
      throw conflict(
        'That email already has an ARC account. Sign in, and add this booking from your account.',
      )
    }
  }

  const passwordHash = await hashPassword(input.password)

  const userId = await prisma.$transaction((tx) =>
    establishAccount(tx, stay, { name: input.name, email, passwordHash }, ['portalToken'], true),
  )

  return { userId }
}


/**
 * Adds a further booking to an account that already exists.
 *
 * This is why `Guest.userId` is no longer unique. A `Guest` is a person at one
 * property — it holds that property's copy of their preferences and intake —
 * so a person who stays at two hotels has two guest records, and an account
 * that could link to only one of them would show them half their travel.
 */
export async function claimStayForAccount(
  userId: string,
  raw: unknown,
  options: { clientKey?: string | null; now?: Date } = {},
): Promise<{ guestId: string; stayId: string }> {
  const input = claimStaySchema.parse(raw)
  const now = options.now ?? new Date()

  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  })
  if (!account) throw notFound('Account')

  await guardClaim({ clientKey: options.clientKey, reference: input.reference, now })

  const email = input.email ?? account.email
  const stay = await findClaimableStay({ reference: input.reference, email }, now)
  if (!stay) throw claimRefused()

  if (stay.guestUser?.id === userId) {
    // Not a refusal: the person is looking at the booking they already have.
    return { guestId: stay.guestId, stayId: stay.id }
  }
  // Somebody else holds it. A placeholder the desk made for this guest is not
  // somebody else, and `holdsAccount` is the one place that judgement lives.
  if (holdsAccount(stay)) throw claimRefused()

  // The row's current owner, as read above, goes in the `where` clause: that
  // is the re-read-inside-the-transaction rule, and it is how a concurrent
  // claim of the same booking loses rather than silently overwriting.
  const expectedOwner = stay.guestUser?.id ?? null

  return prisma.$transaction(async (tx) => {
    const linked = await tx.guest.updateMany({
      where: { id: stay.guestId, userId: expectedOwner },
      data: { userId },
    })
    if (linked.count !== 1) throw claimRefused()

    await recordAudit(
      {
        organizationId: stay.organizationId,
        actor: {
          userId: account.id,
          email: account.email,
          name: account.name,
          isPlatformAdmin: false,
          memberships: [],
        },
        actorKind: 'guest',
        action: 'guest.stay.claimed',
        entityType: 'Guest',
        entityId: stay.guestId,
        metadata: {
          stayId: stay.id,
          claimedWith: ['reference', 'email'],
          tookOverPlaceholder: Boolean(expectedOwner),
        },
      },
      tx,
    )

    return { guestId: stay.guestId, stayId: stay.id }
  })
}

export interface AccountOrderItem {
  id: string
  /**
   * Both titles, not one.
   *
   * `/me` is translated, and picking the language in the module would mean
   * threading a locale into a read that otherwise has no opinion about who is
   * looking. The caller holds the locale; `experienceTitle` resolves it.
   */
  titleEn: string
  titleEs: string | null
  startsAt: Date | null
  quantity: number
  totalMinor: number
  /** What has been refunded against this line, minor units. Usually zero. */
  refundedMinor: number
  currency: string
  category: string
  supplierName: string
  meetingPoint: string | null
  durationMinutes: number
  cancelledAt: Date | null
  supplierConfirmed: boolean
}

export interface AccountOrder {
  id: string
  reference: string
  status: OrderStatus
  placedAt: Date
  currency: string
  totalMinor: number
  items: AccountOrderItem[]
}

export interface AccountStay {
  stayId: string
  guestId: string
  reference: string
  checkIn: DateKey
  checkOut: DateKey
  nights: number
  status: StayStatus
  /**
   * Whether this is a room booking or a trip somebody planned without one.
   *
   * The account surface shows both, and must not call a direct trip a stay:
   * "check-in" and a room are things the person did not buy. See ADR-042.
   */
  kind: StayKind
  partySize: number
  locale: AppLocale
  intakeCompleted: boolean
  propertyName: string
  propertyTagline: string | null
  placeName: string | null
  currency: string
  checkInTime: string
  checkOutTime: string
  contactPhone: string | null
  /**
   * The portal link for this stay, or null once the portal has closed.
   *
   * The token is a bearer credential, and this is the one surface that may
   * hand it over: the holder of this account has proved they are the person it
   * belongs to. It is withheld once `resolvePortalContext` would refuse it, so
   * the account never offers a link that 404s.
   */
  portalPath: string | null
  /** Days until check-in; negative once the stay has started. */
  daysUntilCheckIn: number
  itinerary: { id: string; dayCount: number; itemCount: number } | null
  orders: AccountOrder[]
  /**
   * What is actually booked, by day.
   *
   * Deliberately built from the order items rather than from `itinerary`. A
   * generated itinerary is a proposal: it can hold candidates nobody paid for
   * and can go stale the moment something is cancelled. This is the trip the
   * person bought, in the order it happens, which is what somebody opening
   * their account wants to see.
   */
  schedule: ScheduleDay[]
  basketCount: number
}

export interface ScheduleDay {
  date: DateKey
  items: Array<AccountOrderItem & { orderReference: string }>
}

/**
 * What the person has spent, and on what.
 *
 * Per currency, never across them. An account can hold bookings at two
 * properties that price in different currencies, and one figure over both
 * would be a number with no unit — which is the same failure as summing
 * earnings with potential value, in a smaller place.
 *
 * `refundedMinor` is reported beside the gross rather than subtracted into it.
 * "You spent 4,000 and 1,200 came back" is a statement somebody can check
 * against their bank; a single net figure is not.
 */
export interface AccountSpend {
  currency: string
  grossMinor: number
  refundedMinor: number
  netMinor: number
  byCategory: Array<{ category: string; totalMinor: number; itemCount: number }>
}

export interface GuestAccountView {
  userId: string
  name: string
  email: string
  stays: AccountStay[]
  spend: AccountSpend[]
}

/**
 * Everything the account surface shows, in one read.
 *
 * Scoped by `userId` in the `where` clause: the stays are the ones whose guest
 * record carries it, and the plan, orders and basket hang off those stays. No
 * identifier from the client reaches any of it, which is what `CLAUDE.md` asks
 * of a guest-surface read.
 */
export async function getGuestAccount(
  userId: string,
  now = new Date(),
): Promise<GuestAccountView | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  })
  if (!user) return null

  const rows = await prisma.stay.findMany({
    where: {
      guest: { userId },
      status: { notIn: [StayStatus.CANCELLED, StayStatus.NO_SHOW] },
    },
    orderBy: { checkIn: 'desc' },
    select: {
      id: true,
      reference: true,
      checkIn: true,
      checkOut: true,
      status: true,
      kind: true,
      adults: true,
      children: true,
      portalToken: true,
      guest: {
        select: {
          id: true,
          locale: true,
          partySize: true,
          intakeCompletedAt: true,
        },
      },
      property: {
        select: {
          name: true,
          tagline: true,
          currency: true,
          checkInTime: true,
          checkOutTime: true,
          contactPhone: true,
          place: { select: { name: true } },
        },
      },
      itineraries: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, items: { select: { date: true } } },
      },
      orders: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          reference: true,
          status: true,
          createdAt: true,
          currency: true,
          totalMinor: true,
          items: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              quantity: true,
              lineTotalMinor: true,
              refundedMinor: true,
              currency: true,
              cancelledAt: true,
              supplierConfirmedAt: true,
              slot: { select: { startsAt: true } },
              experience: {
                select: {
                  titleEn: true,
                  titleEs: true,
                  category: true,
                  durationMinutes: true,
                  meetingPoint: true,
                  supplier: { select: { name: true } },
                },
              },
            },
          },
        },
      },
      carts: {
        where: { status: 'OPEN' },
        select: { _count: { select: { items: true } } },
      },
    },
  })

  const today = toDateKey(now)

  const stays: AccountStay[] = rows.map((stay) => {
    const checkIn = toDateKey(stay.checkIn)
    const checkOut = toDateKey(stay.checkOut)
    const expired = daysBetween(checkOut, today) > PORTAL_GRACE_DAYS
    const plan = stay.itineraries[0]

    return {
      stayId: stay.id,
      guestId: stay.guest.id,
      reference: stay.reference,
      kind: stay.kind,
      checkIn,
      checkOut,
      nights: Math.max(1, daysBetween(checkIn, checkOut)),
      status: stay.status,
      partySize: Math.max(1, stay.adults + stay.children, stay.guest.partySize),
      locale: fromPrismaLocale(stay.guest.locale),
      intakeCompleted: Boolean(stay.guest.intakeCompletedAt),
      propertyName: stay.property.name,
      propertyTagline: stay.property.tagline,
      placeName: stay.property.place?.name ?? null,
      currency: stay.property.currency,
      checkInTime: stay.property.checkInTime,
      checkOutTime: stay.property.checkOutTime,
      contactPhone: stay.property.contactPhone,
      portalPath: expired ? null : `/g/${stay.portalToken}`,
      daysUntilCheckIn: daysBetween(today, checkIn),
      itinerary: plan
        ? {
            id: plan.id,
            dayCount: new Set(plan.items.map((item) => toDateKey(item.date))).size,
            itemCount: plan.items.length,
          }
        : null,
      orders: stay.orders.map((order) => ({
        id: order.id,
        reference: order.reference,
        status: order.status,
        placedAt: order.createdAt,
        currency: order.currency,
        totalMinor: order.totalMinor,
        items: order.items.map((item) => ({
          id: item.id,
          titleEn: item.experience.titleEn,
          titleEs: item.experience.titleEs,
          startsAt: item.slot?.startsAt ?? null,
          quantity: item.quantity,
          totalMinor: item.lineTotalMinor,
          refundedMinor: item.refundedMinor,
          currency: item.currency,
          category: item.experience.category,
          supplierName: item.experience.supplier.name,
          meetingPoint: item.experience.meetingPoint,
          durationMinutes: item.experience.durationMinutes,
          cancelledAt: item.cancelledAt,
          supplierConfirmed: Boolean(item.supplierConfirmedAt),
        })),
      })),
      basketCount: stay.carts.reduce((sum, cart) => sum + cart._count.items, 0),
      schedule: [],
    }
  })

  // The booked trip, day by day. Built after the map above because it reads
  // the mapped orders rather than the rows a second time.
  for (const stay of stays) {
    stay.schedule = scheduleFor(stay.orders)
  }

  // Soonest arrival first, then the ones already behind them.
  stays.sort((a, b) => {
    const aUpcoming = a.daysUntilCheckIn >= 0
    const bUpcoming = b.daysUntilCheckIn >= 0
    if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1
    return aUpcoming
      ? a.daysUntilCheckIn - b.daysUntilCheckIn
      : b.daysUntilCheckIn - a.daysUntilCheckIn
  })

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    stays,
    spend: summariseSpend(stays),
  }
}

/**
 * Booked lines grouped by the day they happen on.
 *
 * A cancelled line stays in the list, struck through by the caller. Somebody
 * looking for the surf lesson they cancelled last night and finding no trace
 * of it has been given a worse answer than one that says it was cancelled.
 * Lines with no departure time — there are none today, but the column is
 * nullable — fall into an `unscheduled` bucket keyed by the empty string
 * rather than being dropped.
 */
function scheduleFor(orders: AccountOrder[]): ScheduleDay[] {
  const days = new Map<DateKey, ScheduleDay['items']>()

  for (const order of orders) {
    for (const item of order.items) {
      // The destination's day, not the server's. The time printed beside this
      // is `toLocalTimeString`, so a UTC key put an 18:00 departure on
      // tomorrow's heading with today's time under it.
      const key = item.startsAt ? toLocalDateKey(item.startsAt) : ''
      const bucket = days.get(key) ?? []
      bucket.push({ ...item, orderReference: order.reference })
      days.set(key, bucket)
    }
  }

  return [...days.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([date, items]) => ({
      date,
      items: items.sort((a, b) => (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0)),
    }))
}

/**
 * What was spent, per currency and per category.
 *
 * A cancelled line is excluded from the category breakdown but its refund is
 * still reported, because the money did leave the account and come back and
 * the person may be looking for exactly that.
 */
function summariseSpend(stays: AccountStay[]): AccountSpend[] {
  const byCurrency = new Map<
    string,
    { grossMinor: number; refundedMinor: number; categories: Map<string, { totalMinor: number; itemCount: number }> }
  >()

  for (const stay of stays) {
    for (const order of stay.orders) {
      for (const item of order.items) {
        const entry = byCurrency.get(item.currency) ?? {
          grossMinor: 0,
          refundedMinor: 0,
          categories: new Map<string, { totalMinor: number; itemCount: number }>(),
        }
        entry.grossMinor += item.totalMinor
        entry.refundedMinor += item.refundedMinor
        if (!item.cancelledAt) {
          const category = entry.categories.get(item.category) ?? { totalMinor: 0, itemCount: 0 }
          category.totalMinor += item.totalMinor
          category.itemCount += 1
          entry.categories.set(item.category, category)
        }
        byCurrency.set(item.currency, entry)
      }
    }
  }

  return [...byCurrency.entries()]
    .map(([currency, entry]) => ({
      currency,
      grossMinor: entry.grossMinor,
      refundedMinor: entry.refundedMinor,
      netMinor: entry.grossMinor - entry.refundedMinor,
      byCategory: [...entry.categories.entries()]
        .map(([category, totals]) => ({ category, ...totals }))
        .sort((a, b) => b.totalMinor - a.totalMinor),
    }))
    .sort((a, b) => b.netMinor - a.netMinor)
}

/**
 * One order, for the page somebody lands on after paying.
 *
 * Scoped by `userId` inside the `where` clause rather than checked afterwards,
 * which is what `CLAUDE.md` asks of a guest-surface read that accepts a
 * client-supplied identifier: the reference is on a confirmation and in a URL,
 * and ownership is a predicate rather than something to remember to test.
 */
export async function getGuestOrder(
  userId: string,
  reference: string,
  now = new Date(),
): Promise<{ stay: AccountStay; order: AccountOrder } | null> {
  const account = await getGuestAccount(userId, now)
  if (!account) return null

  const wanted = reference.trim().toUpperCase()
  for (const stay of account.stays) {
    const order = stay.orders.find((candidate) => candidate.reference.toUpperCase() === wanted)
    if (order) return { stay, order }
  }
  return null
}

/**
 * A booked item's title in the reader's language, falling back to English.
 *
 * The portal already does this, and `/me` showing English activity names in a
 * Spanish session while the same bookings read correctly behind the QR code is
 * the kind of half-translation that makes the whole surface feel untrusted.
 */
export function experienceTitle(
  item: { titleEn: string; titleEs: string | null },
  locale: AppLocale,
): string {
  return locale === 'es' ? (item.titleEs ?? item.titleEn) : item.titleEn
}

/** Whether a signed-in user has any guest records, used to pick a landing page. */
export async function hasGuestRecords(userId: string): Promise<boolean> {
  const guest = await prisma.guest.findFirst({ where: { userId }, select: { id: true } })
  return Boolean(guest)
}
