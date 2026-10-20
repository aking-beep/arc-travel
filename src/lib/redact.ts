import { createHmac } from 'node:crypto'

/**
 * PII redaction for logs, audit metadata and AI prompts.
 *
 * Guest contact details must never reach a log line, an AgentRun input payload
 * or a third-party provider. This runs on every structured payload we persist
 * outside the primary tables.
 */
/**
 * Key names whose values are redacted wholesale.
 *
 * `ip` is anchored deliberately: as a bare substring it also matched
 * `descr[ip]tion` and `partic[ip]antNotes`, quietly hollowing out the audit
 * trail the product's credibility rests on. Dietary and mobility notes are
 * here because they are special-category data about a guest's health.
 */
const SENSITIVE_KEY =
  /(email|phone|password|passphrase|token|secret|apikey|api_key|authorization|credential|\bip\b|ipaddr|ip_address|card|cvv|iban|passport|dietary|mobility|medical|allerg)/i

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

/**
 * Stable pseudonym for analytics.
 *
 * HMAC-SHA256 truncated to 128 bits. The previous implementation was a 32-bit
 * FNV-1a hash salted with `AUTH_SECRET`, which was wrong twice over: 32 bits
 * collides around 77,000 subjects and is brute-forceable over any realistic id
 * space, and reusing the session-signing secret turned the analytics table
 * into an oracle on it. The salt is now a dedicated value, so compromising one
 * does not weaken the other.
 */
export function pseudonymize(value: string, salt: string): string {
  return createHmac('sha256', salt).update(value).digest('base64url').slice(0, 22)
}
