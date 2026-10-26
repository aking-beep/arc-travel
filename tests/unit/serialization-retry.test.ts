import { describe, expect, it } from 'vitest'
import { isRetriableTransactionError } from '@/lib/serialization'

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
describe('isRetriableTransactionError', () => {
  it("recognises Prisma's own P2034", () => {
    expect(isRetriableTransactionError({ code: 'P2034' })).toBe(true)
  })

  it('recognises the raw SQLSTATE', () => {
    expect(isRetriableTransactionError({ code: '40001' })).toBe(true)
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
    expect(isRetriableTransactionError(error)).toBe(true)
  })

  it('recognises the adapter kind on its own', () => {
    expect(isRetriableTransactionError({ kind: 'TransactionWriteConflict' })).toBe(true)
  })

  it('walks a nested cause chain', () => {
    const error = { cause: { cause: { cause: { code: 'P2034' } } } }

    expect(isRetriableTransactionError(error)).toBe(true)
  })

  it('stops walking rather than following a cycle forever', () => {
    const error: { cause?: unknown } = {}
    error.cause = error

    expect(isRetriableTransactionError(error)).toBe(false)
  })

  it('does not claim a unique-constraint violation', () => {
    expect(isRetriableTransactionError({ code: 'P2002' })).toBe(false)
  })

  it('recognises a deadlock, whose victim is aborted whole and may be re-run', () => {
    expect(isRetriableTransactionError({ code: '40P01' })).toBe(true)
    expect(isRetriableTransactionError({ originalCode: '40P01' })).toBe(true)
  })

  it('tolerates a thrown non-object', () => {
    expect(isRetriableTransactionError('P2034')).toBe(false)
    expect(isRetriableTransactionError(null)).toBe(false)
    expect(isRetriableTransactionError(undefined)).toBe(false)
  })
})
