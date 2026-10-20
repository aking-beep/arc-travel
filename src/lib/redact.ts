/**
 * PII redaction for logs, audit metadata and AI prompts.
 *
 * Guest contact details must never reach a log line, an AgentRun input payload
 * or a third-party provider. This runs on every structured payload we persist
 * outside the primary tables.
 */
const SENSITIVE_KEY = /(email|phone|password|token|secret|apikey|api_key|authorization|ip|card|cvv|iban|passport)/i

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g

export function redactString(value: string): string {
  return value.replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[phone]')
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return '[depth-limit]' as unknown as T
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactString(value) as unknown as T
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T
  if (value instanceof Date) return value

  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(raw, depth + 1)
  }
  return out as unknown as T
}

/** Stable pseudonym for analytics. Not reversible without the salt. */
export function pseudonymize(value: string, salt: string): string {
  let hash = 2166136261
  const input = `${salt}:${value}`
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).padStart(7, '0')
}
