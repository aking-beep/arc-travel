import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getEnv, resetEnvCache } from '@/lib/env'

/**
 * A setting that is read and does nothing is worse than a setting that is
 * missing.
 *
 * `MAPS_PROVIDER`, `CONDITIONS_PROVIDER`, `MESSAGING_PROVIDER` and
 * `ANALYTICS_PROVIDER` each accepted names with no implementation behind them,
 * and `getIntegrations()` returned the fixture whatever they said.
 * `CONDITIONS_PROVIDER=stormglass` was the sharp one: the operator who set it
 * believed live marine data was feeding the conditions gate, and the gate was
 * reading seeded rows.
 *
 * These tests are about the refusal being *specific*. Zod would already reject
 * `stormglass` now that the enum is one value wide, but with the message
 * "invalid enum value" — which reads as a typo and invites a second guess. The
 * operator needs to be told the provider is unbuilt and what is actually
 * answering instead.
 */
const REQUIRED = {
  DATABASE_URL: 'postgresql://arc:arc@127.0.0.1:5432/arc_stay_env_test?schema=public',
  NODE_ENV: 'test',
}

let saved: NodeJS.ProcessEnv

beforeEach(() => {
  saved = process.env
  process.env = { ...REQUIRED } as NodeJS.ProcessEnv
  resetEnvCache()
})

afterEach(() => {
  process.env = saved
  resetEnvCache()
})

describe('unimplemented providers', () => {
  it('boots with nothing but a database url', () => {
    const env = getEnv()
    expect(env.MAPS_PROVIDER).toBe('fixture')
    expect(env.CONDITIONS_PROVIDER).toBe('fixture')
    expect(env.MESSAGING_PROVIDER).toBe('noop')
    expect(env.ANALYTICS_PROVIDER).toBe('internal')
  })

  it.each([
    ['CONDITIONS_PROVIDER', 'stormglass'],
    ['CONDITIONS_PROVIDER', 'openweather'],
    ['MAPS_PROVIDER', 'mapbox'],
    ['MAPS_PROVIDER', 'google'],
    ['MESSAGING_PROVIDER', 'twilio'],
    ['MESSAGING_PROVIDER', 'resend'],
    ['ANALYTICS_PROVIDER', 'posthog'],
  ])('refuses %s=%s by name', (key, value) => {
    process.env[key] = value
    expect(() => getEnv()).toThrow(/not implemented/)
    expect(() => getEnv()).toThrow(new RegExp(`${key}=${value}`))
  })

  it('tells a conditions operator what the safety gate actually reads', () => {
    process.env.CONDITIONS_PROVIDER = 'stormglass'
    // The one message where a vague refusal has a safety consequence: an
    // operator who thinks live swell data gates recommendations will not go
    // looking for the seeded table.
    expect(() => getEnv()).toThrow(/seeded ConditionReport rows/)
    expect(() => getEnv()).toThrow(/safety gate/)
  })

  it('still refuses an unknown name, as a validation error', () => {
    process.env.MAPS_PROVIDER = 'definitely-not-a-provider'
    expect(() => getEnv()).toThrow(/Invalid environment configuration/)
  })

  it('warns rather than refuses a key for a provider that was never built', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // Having a Stormglass key is not a misconfiguration. Believing it is read
    // is. The provider name is the thing that refuses; a stray credential
    // warns, because refusing it would make an unrelated variable fatal.
    process.env.STORMGLASS_API_KEY = 'sg-not-a-real-key'
    expect(() => getEnv()).not.toThrow()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('is set but ignored'),
      'STORMGLASS_API_KEY',
      expect.stringContaining('seeded ConditionReport rows'),
    )
    warn.mockRestore()
  })
})
