import { reportError } from '@/lib/observability'

/**
 * The one place an unhandled server error is seen.
 *
 * Next calls `onRequestError` for every error thrown out of a Server
 * Component, a route handler or a server action. Wiring reporting here rather
 * than into each handler means there is no handler that can forget — and
 * `toFormState` deliberately re-throws anything that is neither a `ZodError`
 * nor an `AppError`, so a genuine bug in a form action arrives here rather
 * than becoming a message under an input.
 *
 * `reportError` decides whether an error is an incident, from the error
 * taxonomy: a 4xx `AppError` is counted and a fault is reported. See
 * `src/lib/observability.ts`.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routeType: string },
): Promise<void> {
  await reportError(error, {
    /*
     * The route *path*, as Next matched it — not the URL.
     *
     * A URL carries a portal token in `/g/[token]`, which is a bearer
     * credential; a search string carries whatever a guest typed. Neither
     * belongs in a third-party issue tracker, and `where` is a tag that groups
     * reports, so a per-guest value would be useless there anyway.
     */
    where: `${request.method} ${request.path}`,
    extra: {
      routerKind: context.routerKind,
      routeType: context.routeType,
    },
  })
}
