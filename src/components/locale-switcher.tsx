import { setLocaleAction } from '@/app/actions'
import { cn } from '@/lib/cn'
import type { AppLocale } from '@/lib/i18n'

/**
 * Two-language toggle implemented as two server-action buttons rather than a
 * client-side select, so switching language works with JavaScript disabled and
 * does not need a hydration boundary.
 */
export function LocaleSwitcher({
  locale,
  next,
  className,
}: {
  locale: AppLocale
  next: string
  className?: string
}) {
  return (
    <div className={cn('border-sand-300 flex overflow-hidden rounded-lg border', className)}>
      {(['en', 'es'] as const).map((code) => (
        <form key={code} action={setLocaleAction}>
          <input type="hidden" name="locale" value={code} />
          <input type="hidden" name="next" value={next} />
          <button
            type="submit"
            aria-current={locale === code ? 'true' : undefined}
            className={cn(
              'px-2.5 py-1 text-xs font-medium uppercase transition-colors',
              locale === code
                ? 'bg-jade-800 text-jade-50'
                : 'text-sand-600 hover:bg-sand-100 bg-white',
            )}
          >
            {code}
          </button>
        </form>
      ))}
    </div>
  )
}
