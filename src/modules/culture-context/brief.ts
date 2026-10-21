import { SourceClass } from '@/lib/prisma-types'
import {
  providerFailed,
  type ProviderResult,
  type TravelAdviceDocument,
  type TravelAdviceProvider,
} from '@/modules/integrations/types'
import { govukPublicUrl } from '@/modules/integrations/govuk'
import { rankBriefItems, toBriefItem } from './applicability'
import { GOVUK_AUTHORITY, govukSourceKey, parseGovUkAdvice } from './govuk'
import {
  briefSchema,
  travelerProfileSchema,
  type Brief,
  type BriefItem,
  type BriefWarning,
  type SourceStatus,
  type TravelerProfileInput,
} from './schemas'

/**
 * The brief service.
 *
 * Takes a traveller and a provider, returns the sourced items that apply, plus
 * warnings that say what the brief does *not* know. Deterministic given its
 * inputs: the provider is injected and the clock is a parameter.
 *
 * The source-down path is the point of the design. When the source fails, the
 * brief carries a `SOURCE_UNAVAILABLE` warning and no items from that source.
 * It never substitutes remembered, cached or model-written text, because a
 * plausible sentence about a country's drug laws that nobody can trace to a
 * source is worse than "we could not reach the source".
 */
export interface BuildBriefOptions {
  travelAdvice: TravelAdviceProvider
  now?: Date
}

const warning = (
  code: BriefWarning['code'],
  sourceKey: string | null = null,
  reason: string | null = null,
): BriefWarning => ({ code, sourceKey, reason })

export async function buildBrief(
  input: TravelerProfileInput,
  options: BuildBriefOptions,
): Promise<Brief> {
  const traveler = travelerProfileSchema.parse(input)
  const sourceKey = govukSourceKey(traveler.destinationSlug)

  // Always present. Coverage is partial, and an advisory is not the law.
  const warnings: BriefWarning[] = [warning('COVERAGE_PARTIAL'), warning('ADVISORY_NOT_LAW')]
  if (traveler.nationality === null) warnings.push(warning('NATIONALITY_UNKNOWN'))

  let result: ProviderResult<TravelAdviceDocument>
  try {
    result = await options.travelAdvice.getAdvice({ slug: traveler.destinationSlug })
  } catch {
    // A provider is meant to return a failure, not throw one. If it throws
    // anyway, the guest still gets an honest "unavailable", not a broken page.
    result = providerFailed(options.travelAdvice.name, 'provider_threw')
  }

  const status: SourceStatus = {
    sourceKey,
    authority: GOVUK_AUTHORITY,
    sourceClass: SourceClass.GOVERNMENT_ADVISORY,
    url: govukPublicUrl(traveler.destinationSlug),
    provider: result.provider,
    ok: false,
    reason: result.reason,
    retrievedAt: null,
    contentHash: null,
    isFixture: false,
  }

  let items: BriefItem[] = []

  if (!result.ok || !result.data) {
    warnings.push(warning('SOURCE_UNAVAILABLE', sourceKey, result.reason ?? 'unknown'))
  } else {
    const parsed = parseGovUkAdvice(result.data, traveler.destinationCountry)
    Object.assign(status, {
      ok: true,
      reason: null,
      url: result.data.sourceUrl,
      retrievedAt: result.data.retrievedAt,
      contentHash: parsed.contentHash,
      isFixture: result.data.isFixture,
    })
    if (result.data.isFixture) warnings.push(warning('FIXTURE_DATA', sourceKey))

    if (parsed.rules.length === 0) {
      status.ok = false
      status.reason = 'no_expected_sections'
      warnings.push(warning('SOURCE_UNPARSEABLE', sourceKey, 'no_expected_sections'))
    } else {
      items = rankBriefItems(
        parsed.rules
          .map((rule) => toBriefItem(rule, traveler))
          .filter((item): item is BriefItem => item !== null),
      )
    }
  }

  // Parse on the way out: the brief is the contract the UI renders from, and
  // `ruleRecordSchema` has already refused any advisory dressed as law.
  return briefSchema.parse({
    destinationCountry: traveler.destinationCountry,
    generatedAt: options.now ?? new Date(),
    coverage: 'PARTIAL',
    warnings,
    items,
    sources: [status],
  })
}

/** For a destination this module does not cover: says so, and shows nothing. */
export function unsupportedDestinationBrief(now: Date = new Date()): Brief {
  return {
    destinationCountry: '',
    generatedAt: now,
    coverage: 'PARTIAL',
    warnings: [warning('COVERAGE_PARTIAL'), warning('DESTINATION_UNSUPPORTED')],
    items: [],
    sources: [],
  }
}
