import type { AICallOptions, AIProvider, AIResult } from './provider'
import { SHARED_SYSTEM_RULES } from './provider'

/**
 * Optional live provider.
 *
 * Off by default and never exercised in the POC. It is here so the boundary is
 * demonstrably real rather than theoretical — the same narrow contract, the
 * same Zod validation on the way out, and no tool surface.
 *
 * Deliberately implemented with `fetch` rather than an SDK: one HTTP call
 * against a documented JSON shape is less to keep current than a dependency,
 * and it keeps the POC's install free of a package nothing uses by default.
 */
interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

/**
 * Published per-million-token prices, in USD micro-dollars, used only for the
 * cost telemetry on AgentRun. Wrong numbers here cost nothing but a misleading
 * dashboard, which is why the field is named `costMicroUsd` and treated as an
 * estimate everywhere it is read.
 */
const PRICING_MICRO_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5-5': { input: 3_000_000, output: 15_000_000 },
  'claude-haiku-5-5': { input: 1_000_000, output: 5_000_000 },
  'claude-opus-5-5': { input: 15_000_000, output: 75_000_000 },
}

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic'
  readonly model: string

  private readonly apiKey: string
  private readonly maxTokens: number

  constructor(options: { apiKey: string; model: string; maxTokens: number }) {
    this.apiKey = options.apiKey
    this.model = options.model
    this.maxTokens = options.maxTokens
  }

  async complete<T>(options: AICallOptions<T>): Promise<AIResult<T>> {
    const started = Date.now()

    const base = {
      provider: this.name,
      model: this.model,
      inputTokens: 0,
      outputTokens: 0,
      costMicroUsd: 0,
      latencyMs: 0,
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: options.maxTokens ?? this.maxTokens,
          system: `${SHARED_SYSTEM_RULES}\n\n${options.system}\n\nRespond with JSON only, matching the requested shape. No prose outside the JSON.`,
          messages: [{ role: 'user', content: JSON.stringify(options.input) }],
        }),
        signal: AbortSignal.timeout(30_000),
      })

      if (!response.ok) {
        return {
          ...base,
          ok: false,
          data: null,
          latencyMs: Date.now() - started,
          validationError: null,
          blockedReason: `provider_http_${response.status}`,
        }
      }

      const payload = (await response.json()) as AnthropicResponse
      const text = (payload.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('')

      const inputTokens = payload.usage?.input_tokens ?? 0
      const outputTokens = payload.usage?.output_tokens ?? 0
      const pricing = PRICING_MICRO_USD_PER_MTOK[this.model]
      const costMicroUsd = pricing
        ? Math.round(
            (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output,
          )
        : 0

      const usage = { ...base, inputTokens, outputTokens, costMicroUsd, latencyMs: Date.now() - started }

      let candidate: unknown
      try {
        candidate = JSON.parse(extractJson(text))
      } catch {
        return {
          ...usage,
          ok: false,
          data: null,
          validationError: 'Response was not valid JSON.',
          blockedReason: null,
        }
      }

      // The output contract is enforced here, not trusted. A model that returns
      // something outside the schema produces a failed AgentRun, and the caller
      // falls back to the deterministic text.
      const parsed = options.schema.safeParse(candidate)
      return {
        ...usage,
        ok: parsed.success,
        data: parsed.success ? parsed.data : null,
        validationError: parsed.success ? null : parsed.error.message,
        blockedReason: null,
      }
    } catch (error) {
      return {
        ...base,
        ok: false,
        data: null,
        latencyMs: Date.now() - started,
        validationError: null,
        blockedReason: error instanceof Error ? `provider_error:${error.name}` : 'provider_error',
      }
    }
  }
}

/** Tolerates a model that wraps its JSON in a fenced block. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced?.[1]) return fenced[1].trim()
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) return text.slice(firstBrace, lastBrace + 1)
  return text.trim()
}
