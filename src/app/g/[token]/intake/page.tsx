import { resolvePortalForRequest } from '../resolve'
import { getGuestPreferences } from '@/modules/preferences/service'
import { getLocale } from '@/lib/i18n/server'
import { createTranslator } from '@/lib/i18n'
import { IntakeForm } from './form'

export const metadata = { title: 'Your preferences' }

export default async function IntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const context = await resolvePortalForRequest(token)
  const preferences = await getGuestPreferences(context.guestId)
  const locale = await getLocale()
  const t = createTranslator(locale)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-semibold">{t('guest.intakeTitle')}</h2>
        <p className="text-sand-600 mt-1 text-sm">{t('guest.intakeSub')}</p>
      </div>

      <IntakeForm
        token={token}
        locale={locale}
        defaults={{
          interests: preferences.interests,
          surfAbility: preferences.surfAbility,
          pace: preferences.pace,
          partySize: preferences.partySize || context.partySize,
          budget: preferences.budgetPerDayMinor
            ? String(Math.round(preferences.budgetPerDayMinor / 100))
            : '',
          preferredTransport: preferences.preferredTransport,
          dietaryNotes: preferences.dietaryNotes ?? '',
          mobilityNotes: preferences.mobilityNotes ?? '',
          personalizationConsent: preferences.personalizationAllowed,
          marketingConsent: preferences.marketingAllowed,
        }}
      />
    </div>
  )
}
