import { dictionary, DEFAULT_LOCALE, LOCALES, type AppLocale, type MessageKey } from './dictionary'

export { dictionary, DEFAULT_LOCALE, LOCALES }
export type { AppLocale, MessageKey }

/**
 * Compile-time guarantee that the Spanish catalogue covers every English key.
 * If a key is added to `en` and forgotten in `es`, this line fails typecheck.
 */
type AssertComplete<T extends Record<MessageKey, string>> = T
export type _EsIsComplete = AssertComplete<(typeof dictionary)['es']>

export type Translator = (key: MessageKey, vars?: Record<string, string | number>) => string

/** Interpolates `{name}` placeholders; a missing key returns the key itself. */
export function createTranslator(locale: AppLocale): Translator {
  const table = dictionary[locale] ?? dictionary[DEFAULT_LOCALE]
  return (key, vars) => {
    const raw: string = table[key] ?? dictionary[DEFAULT_LOCALE][key] ?? key
    if (!vars) return raw
    return raw.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars[name] ?? `{${name}}`))
  }
}

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** Normalises an `Accept-Language` header or a stored Prisma `Locale`. */
export function resolveLocale(input: string | null | undefined): AppLocale {
  if (!input) return DEFAULT_LOCALE
  const lowered = input.toLowerCase()
  if (lowered.startsWith('es')) return 'es'
  if (lowered.startsWith('en')) return 'en'
  return DEFAULT_LOCALE
}

export const toPrismaLocale = (locale: AppLocale): 'EN' | 'ES' =>
  locale === 'es' ? 'ES' : 'EN'

export const fromPrismaLocale = (locale: 'EN' | 'ES'): AppLocale =>
  locale === 'ES' ? 'es' : 'en'

export const LOCALE_COOKIE = 'arc_locale'
