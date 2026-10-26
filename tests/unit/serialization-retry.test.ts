import { describe, expect, it } from 'vitest'
import { isSerializationFailure } from '@/lib/serialization'

/*
 * The predicate every Serializable retry loop hinges on.
 *
 * The bug this pins: under the `PrismaPg` driver adapter a serialization
 * failure has no `P2034` code, so the retry loop in
 * `modules/inventory/service.ts` treated it as a genuine error and let it out
 * as a 500. The six-guest race in `tests/e2e/11-concurrency.spec.ts` then
 * failed with nobody added, which reads as a deadlock and is really a missed
 * retry. One shape per test, so a regression says which shape came back.
 */
describe('isSerializationFailure', () => {
  it("recognises Prisma's own P2034", () => {
    expect(isSerializationFailure({ code: 'P2034' })).toBe(true)
  })

  it('recognises the raw SQLSTATE', () => {
    expect(isSerializationFailure({ code: '40001' })).toBe(true)
  })

  it('recognises the driver-adapter error that has no code at all', () => {
    const error = Object.assign(new Error('TransactionWriteConflict'), {
      cause: {
        originalCode: '40001',
        originalMessage: 'could not serialize access due to read/write dependencies among transactions',
        kind: 'TransactionWriteConflict',
      },
    })

    expect((error as { code?: string }).code).toBeUndefined()
    expect(isSerializationFailure(error)).toBe(true)
  })

  it('recognises the adapter kind on its own', () => {
    expect(isSerializationFailure({ kind: 'TransactionWriteConflict' })).toBe(true)
  })

  it('walks a nested cause chain', () => {
    const error = { cause: { cause: { cause: { code: 'P2034' } } } }

    expect(isSerializationFailure(error)).toBe(true)
  })

  it('stops walking rather than following a cycle forever', () => {
    const error: { cause?: unknown } = {}
    error.cause = error

    expect(isSerializationFailure(error)).toBe(false)
  })

  it('does not claim a unique-constraint violation', () => {
    expect(isSerializationFailure({ code: 'P2002' })).toBe(false)
  })

  it('does not claim a deadlock, which is not a serialization failure', () => {
    expect(isSerializationFailure({ code: '40P01' })).toBe(false)
  })

  it('tolerates a thrown non-object', () => {
    expect(isSerializationFailure('P2034')).toBe(false)
    expect(isSerializationFailure(null)).toBe(false)
    expect(isSerializationFailure(undefined)).toBe(false)
  })
})
