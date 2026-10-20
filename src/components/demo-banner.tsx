import { AlertTriangle } from 'lucide-react'
import { getTranslator } from '@/lib/i18n/server'
import { getEnv } from '@/lib/env'

/**
 * Standing notice that nothing on screen is real.
 *
 * Shown on every surface while ARC_DATA_MODE=demo. It is deliberately not
 * dismissible: a hotel owner being walked through the product should never be
 * more than one glance from knowing that the revenue figures are synthetic.
 */
export async function DemoBanner() {
  if (getEnv().ARC_DATA_MODE !== 'demo') return null
  const { t } = await getTranslator()

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-amber-900">
      <div className="mx-auto flex max-w-6xl items-start gap-2 text-xs leading-snug">
        <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
        <p>{t('common.demoBanner')}</p>
      </div>
    </div>
  )
}
