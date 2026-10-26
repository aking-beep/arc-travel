/**
 * Recognising a transaction that Postgres aborted and that is safe to re-run.
 *
 * Two SQLSTATEs qualify. **40001**, a serialization failure: a Serializable
 * transaction could not be ordered against a concurrent one. **40P01**, a
 * deadlock: two transactions took the same locks in opposite orders and
 * Postgres chose a victim. Both abort the whole transaction and leave nothing
 * behind, so re-running the function from the top is correct — which is
 * exactly what `inSerializableTransaction` does. The predicate lives here, in
 * `lib`, because two modules ask the question and neither should import the
 * other to do it.
 *
 * It has to match more than Prisma's `P2034`. Prisma raises that code only
 * when Prisma itself detects the failure; under the `PrismaPg` driver adapter
 * the same failure arrives as a `DriverAdapterError` carrying the raw SQLSTATE
 * and a `kind` in its cause, with no `code` at all. Checking for `P2034` alone
 * meant the retry loop in `modules/inventory/service.ts` stopped retrying and
 * let the error out as a 500: six guests racing one departure all lost, which
 * is the single outcome that file exists to prevent. The cause chain is walked
 * because the adapter nests its own cause.
 */
export function isRetriableTransactionError(error: unknown): boolean {
  let current: unknown = error

  for (let depth = 0; current !== null && current !== undefined && depth < 5; depth += 1) {
    const candidate = current as {
      code?: unknown
      originalCode?: unknown
      kind?: unknown
      cause?: unknown
    }

    if (
      candidate.code === 'P2034' ||
      candidate.code === '40001' ||
      candidate.code === '40P01' ||
      candidate.originalCode === '40001' ||
      candidate.originalCode === '40P01' ||
      candidate.kind === 'TransactionWriteConflict'
    ) {
      return true
    }

    current = candidate.cause
  }

  return false
}
