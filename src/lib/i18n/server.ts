import { cookies, headers } from 'next/headers'
import {
  createTranslator,
  isAppLocale,
  LOCALE_COOKIE,
  resolveLocale,
  type AppLocale,
  type Translator,
} from './index'

/**
 * Resolves the active locale for a server render: an explicit cookie choice
 * first, then the browser's `Accept-Language`, then English.
 */
export async function getLocale(): Promise<AppLocale> {
  const store = await cookies()
  const fromCookie = store.get(LOCALE_COOKIE)?.value
  if (isAppLocale(fromCookie)) return fromCookie

  const h = await headers()
  return resolveLocale(h.get('accept-language'))
}

export async function getTranslator(): Promise<{ locale: AppLocale; t: Translator }> {
  const locale = await getLocale()
  return { locale, t: createTranslator(locale) }
}
