/**
 * The load test.
 *
 * Not a benchmark. The question is not "how many requests per second" — the
 * deployment target is serverless and that number is somebody else's — but
 * **does the inventory model hold under concurrency**, and **does it hold while
 * the read surfaces are also being hammered**.
 *
 * The integration suite already proves the first part at the service level:
 * `tests/integration/inventory.test.ts` races `placeHold` and asserts the
 * Serializable transaction does its job. What it cannot prove is that the same
 * thing holds over HTTP, through a connection pool, against a production build,
 * with the read paths competing for connections. A pooler in transaction mode
 * would pass every integration test and fail here, which is the failure this
 * script exists to find (see the pooling note in docs/deployment.md).
 *
 *   node scripts/load-test.mjs                     # against localhost:3100
 *   BASE_URL=https://… node scripts/load-test.mjs
 *
 * Read-only, and it stays that way. An HTTP load test cannot drive a Next
 * server action — the action protocol is not something to hand-craft, and a
 * hand-crafted POST that silently 404s would report a passing oversell race,
 * which is worse than no race at all. The write path is tested where it can
 * actually be driven: `tests/integration/inventory.test.ts` races `placeHold`
 * at the service level, and `tests/e2e/11-concurrency.spec.ts` races six real
 * browsers at one departure through the real UI.
 */
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3100'
const DURATION_MS = Number(process.env.DURATION_MS ?? 15_000)
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 24)

const PATHS = ['/', '/experiences', '/stays', '/sign-in', '/api/health']

const results = new Map()

function record(path, ms, status) {
  const r = results.get(path) ?? { n: 0, errors: 0, latencies: [], statuses: new Map() }
  r.n += 1
  r.latencies.push(ms)
  r.statuses.set(status, (r.statuses.get(status) ?? 0) + 1)
  if (typeof status === 'number' ? status >= 500 : true) r.errors += 1
  results.set(path, r)
}

async function hit(path) {
  const started = performance.now()
  try {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual' })
    // Drain the body: leaving it unread measures time-to-headers, which is not
    // what a person waits for.
    await res.arrayBuffer()
    record(path, performance.now() - started, res.status)
  } catch (error) {
    record(path, performance.now() - started, error instanceof Error ? error.message : 'error')
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[i]
}

async function worker(deadline) {
  let i = 0
  while (performance.now() < deadline) {
    await hit(PATHS[i % PATHS.length])
    i += 1
  }
}

async function main() {
  console.log(`Load test against ${BASE}`)
  console.log(`${String(CONCURRENCY)} concurrent clients for ${String(DURATION_MS / 1000)}s\n`)

  // Warm the routes first. Every page is server-rendered on demand, so the
  // first hit to each pays compilation and a cold pool; including that in the
  // percentiles measures the first visitor of the day and calls it the median.
  for (const path of PATHS) await hit(path)
  results.clear()

  const deadline = performance.now() + DURATION_MS
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(deadline)))

  let total = 0
  let failed = 0
  console.log('path                  n     p50     p95     p99     max   errors')
  console.log('─'.repeat(70))
  for (const path of PATHS) {
    const r = results.get(path)
    if (!r) continue
    const sorted = [...r.latencies].sort((a, b) => a - b)
    total += r.n
    failed += r.errors
    console.log(
      `${path.padEnd(18)} ${String(r.n).padStart(5)} ` +
        [50, 95, 99].map((p) => `${percentile(sorted, p).toFixed(0).padStart(7)}`).join(' ') +
        ` ${sorted[sorted.length - 1].toFixed(0).padStart(7)} ${String(r.errors).padStart(8)}`,
    )
  }
  console.log('─'.repeat(70))
  console.log(
    `${String(total)} requests, ${(total / (DURATION_MS / 1000)).toFixed(0)}/s, ${String(failed)} failed\n`,
  )

  for (const path of PATHS) {
    const r = results.get(path)
    if (!r) continue
    const unexpected = [...r.statuses].filter(([s]) => typeof s !== 'number' || s >= 400)
    if (unexpected.length > 0) {
      console.log(`${path}: ${unexpected.map(([s, n]) => `${String(s)}×${String(n)}`).join(', ')}`)
    }
  }

  process.exitCode = failed === 0 ? 0 : 1
}

await main()
