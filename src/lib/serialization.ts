/**
 * Recognising a Postgres serialization failure, whatever shape it arrives in.
 *
 * Postgres raises SQLSTATE 40001 when a Serializable transaction cannot be
 * ordered against a concurrent one. Retrying is the expected response, so the
 * predicate that spots one is the hinge of every retry loop in the project —
 * and it lives here, in `lib`, because two modules ask the question and
 * neither should import the other to do it.
 *
 * It has to match more than Prisma's own `P2034`. Prisma raises that code only
 * when Prisma itself detects the failure; under the `PrismaPg` driver adapter
 * the same failure arrives as a `DriverAdapterError` carrying the raw SQLSTATE
 * and a `kind` in its cause, with no `code` at all. Checking for `P2034` alone
 * meant the retry loop in `modules/inventory/service.ts` stopped retrying and
 * let the error out as a 500: six guests racing one departure all lost, which
 * is the single outcome that file exists to prevent. The cause chain is walked
 * because the adapter nests its own cause.
 */
export function isSerializationFailure(error: unknown): boolean {
  let current: unknown = error;

  for (
    let depth = 0;
    current !== null && current !== undefined && depth < 5;
    depth += 1
  ) {
    const candidate = current as {
      code?: unknown;
      originalCode?: unknown;
      kind?: unknown;
      cause?: unknown;
    };

    if (
      candidate.code === "P2034" ||
      candidate.code === "40001" ||
      candidate.originalCode === "40001" ||
      candidate.kind === "TransactionWriteConflict"
    ) {
      return true;
    }

    current = candidate.cause;
  }

  return false;
}
