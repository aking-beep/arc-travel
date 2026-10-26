import { beforeEach, describe, expect, it } from 'vitest'

import { prisma } from '@/lib/db'
import { toDateKey } from '@/lib/dates'
import { VerificationStatus } from '@/lib/prisma-types'
import { verifySupplier } from '@/modules/admin/service'
import {
  INSURANCE_CHECK_KEY,
  REQUIRED_CHECK_KEYS,
  verificationStanding,
} from '@/modules/admin/verification'
import { actorFor, createTenant, resetDatabase, type TenantFixture } from '../helpers/factory'

/**
 * Partner verification, item 8.
 *
 * `/admin` is the only route to a VERIFIED status (non-negotiable 2), and these
 * are the rules that make the status mean something rather than merely exist.
 */
const dayOffset = (days: number): string => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return toDateKey(d)
}

const ALL_CHECKS = [...REQUIRED_CHECK_KEYS]
const NOTE = 'Policy GNP-884210 seen, expires as recorded; RFC from the SAT constancia.'

describe('verifySupplier', () => {
  let tenant: TenantFixture
  let admin: Awaited<ReturnType<typeof actorFor>>

  beforeEach(async () => {
    await resetDatabase()
    tenant = await createTenant()

    const user = await prisma.user.create({
      data: {
        email: `admin-${Date.now().toString()}@arctravel.test`,
        name: 'Platform admin',
        isPlatformAdmin: true,
      },
    })
    admin = await actorFor(user.id)
  })

  it('records the checklist, not just a note', async () => {
    await verifySupplier(admin, {
      supplierId: tenant.supplierId,
      decision: VerificationStatus.VERIFIED,
      note: NOTE,
      checks: ALL_CHECKS,
      insuranceExpiresOn: dayOffset(200),
    })

    const supplier = await prisma.supplier.findUniqueOrThrow({
      where: { id: tenant.supplierId },
      select: {
        verification: true,
        verifiedChecks: true,
        verifiedById: true,
        insuranceOnFile: true,
        insuranceExpiresOn: true,
      },
    })

    expect(supplier.verification).toBe(VerificationStatus.VERIFIED)
    expect([...supplier.verifiedChecks].sort()).toEqual([...ALL_CHECKS].sort())
    expect(supplier.verifiedById).toBe(admin.userId)
    // Derived from the checklist rather than being a second thing to remember.
    expect(supplier.insuranceOnFile).toBe(true)
    expect(supplier.insuranceExpiresOn).not.toBeNull()
  })

  it('refuses to verify with a required check outstanding', async () => {
    await expect(
      verifySupplier(admin, {
        supplierId: tenant.supplierId,
        decision: VerificationStatus.VERIFIED,
        note: NOTE,
        checks: ALL_CHECKS.filter((key) => key !== 'tax_id'),
        insuranceExpiresOn: dayOffset(200),
      }),
    ).rejects.toThrow(/checks outstanding/i)

    const supplier = await prisma.supplier.findUniqueOrThrow({
      where: { id: tenant.supplierId },
      select: { verification: true },
    })
    expect(supplier.verification).not.toBe(VerificationStatus.VERIFIED)
  })

  it('names the outstanding check, so the admin knows what to go and get', async () => {
    await expect(
      verifySupplier(admin, {
        supplierId: tenant.supplierId,
        decision: VerificationStatus.VERIFIED,
        note: NOTE,
        checks: ALL_CHECKS.filter((key) => key !== 'operating_permit'),
        insuranceExpiresOn: dayOffset(200),
      }),
    ).rejects.toThrow(/permission to operate/i)
  })

  it('refuses to verify without an insurance expiry date', async () => {
    await expect(
      verifySupplier(admin, {
        supplierId: tenant.supplierId,
        decision: VerificationStatus.VERIFIED,
        note: NOTE,
        checks: ALL_CHECKS,
        insuranceExpiresOn: null,
      }),
    ).rejects.toThrow(/expiry date/i)
  })

  it('refuses an insurance certificate that has already expired', async () => {
    await expect(
      verifySupplier(admin, {
        supplierId: tenant.supplierId,
        decision: VerificationStatus.VERIFIED,
        note: NOTE,
        checks: ALL_CHECKS,
        insuranceExpiresOn: dayOffset(-1),
      }),
    ).rejects.toThrow(/expired/i)
  })

  it('still requires a note saying what was checked', async () => {
    await expect(
      verifySupplier(admin, {
        supplierId: tenant.supplierId,
        decision: VerificationStatus.VERIFIED,
        note: 'ok',
        checks: ALL_CHECKS,
        insuranceExpiresOn: dayOffset(200),
      }),
    ).rejects.toThrow(/what you actually checked/i)
  })

  it('refuses a check key it does not know', async () => {
    // A renamed or removed key must fail loudly rather than being stored and
    // silently never matching a required one again.
    await expect(
      verifySupplier(admin, {
        supplierId: tenant.supplierId,
        decision: VerificationStatus.VERIFIED,
        note: NOTE,
        checks: [...ALL_CHECKS, 'vibes'],
        insuranceExpiresOn: dayOffset(200),
      }),
    ).rejects.toThrow(/unknown verification check/i)
  })

  it('records a rejection without demanding the full checklist', async () => {
    // The point of rejecting is often that a check cannot be satisfied.
    await verifySupplier(admin, {
      supplierId: tenant.supplierId,
      decision: VerificationStatus.REJECTED,
      note: 'No operating permit and no intention of getting one.',
      checks: ['identity'],
    })

    const supplier = await prisma.supplier.findUniqueOrThrow({
      where: { id: tenant.supplierId },
      select: { verification: true, status: true, verifiedAt: true },
    })
    expect(supplier.verification).toBe(VerificationStatus.REJECTED)
    expect(supplier.status).toBe('SUSPENDED')
    expect(supplier.verifiedAt).toBeNull()
  })

  it('refuses an actor who is not a platform admin', async () => {
    const owner = await actorFor(tenant.ownerUserId)
    await expect(
      verifySupplier(owner, {
        supplierId: tenant.supplierId,
        decision: VerificationStatus.VERIFIED,
        note: NOTE,
        checks: ALL_CHECKS,
        insuranceExpiresOn: dayOffset(200),
      }),
    ).rejects.toThrow()
  })

  it('stops presenting a verification as current once the insurance expires', async () => {
    await verifySupplier(admin, {
      supplierId: tenant.supplierId,
      decision: VerificationStatus.VERIFIED,
      note: NOTE,
      checks: ALL_CHECKS,
      insuranceExpiresOn: dayOffset(3),
    })

    const supplier = await prisma.supplier.findUniqueOrThrow({
      where: { id: tenant.supplierId },
      select: { verification: true, verifiedChecks: true, insuranceExpiresOn: true },
    })

    const today = new Date()
    const later = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000)

    expect(verificationStanding(supplier, today).standing).toBe('verified')
    expect(verificationStanding(supplier, later).standing).toBe('lapsed')
    // The stored decision is NOT rewritten: it was correct on the evidence
    // available when it was made. Only its presentation changes.
    expect(supplier.verification).toBe(VerificationStatus.VERIFIED)
  })

  it('clears the expiry when the insurance check is withdrawn', async () => {
    await verifySupplier(admin, {
      supplierId: tenant.supplierId,
      decision: VerificationStatus.VERIFIED,
      note: NOTE,
      checks: ALL_CHECKS,
      insuranceExpiresOn: dayOffset(200),
    })

    await verifySupplier(admin, {
      supplierId: tenant.supplierId,
      decision: VerificationStatus.PENDING,
      note: 'Insurer says the policy was cancelled. Withdrawing the insurance check.',
      checks: ALL_CHECKS.filter((key) => key !== INSURANCE_CHECK_KEY),
    })

    const supplier = await prisma.supplier.findUniqueOrThrow({
      where: { id: tenant.supplierId },
      select: { insuranceOnFile: true, insuranceExpiresOn: true },
    })
    // Otherwise a stale date would sit there dating a document nobody has.
    expect(supplier.insuranceOnFile).toBe(false)
    expect(supplier.insuranceExpiresOn).toBeNull()
  })

  it('writes an audit row naming the admin and the checks', async () => {
    await verifySupplier(admin, {
      supplierId: tenant.supplierId,
      decision: VerificationStatus.VERIFIED,
      note: NOTE,
      checks: ALL_CHECKS,
      insuranceExpiresOn: dayOffset(200),
    })

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'admin.supplier.verification', entityId: tenant.supplierId },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit.actorUserId).toBe(admin.userId)
    expect(JSON.stringify(audit.metadataJson)).toContain(INSURANCE_CHECK_KEY)
  })
})
