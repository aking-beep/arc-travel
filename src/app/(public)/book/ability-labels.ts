import type { Translator } from '@/lib/i18n'
import type { AbilityFieldProps } from './forms'

const ABILITIES = ['BEGINNER', 'IMPROVER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const

/**
 * The ability control's copy, built once.
 *
 * Two surfaces render the same control — the panel on a property page and the
 * one on the trip page — and a label that drifted between them would make the
 * second look like a different question.
 */
export function abilityField(t: Translator, value: string | null): AbilityFieldProps {
  return {
    value,
    label: t('explore.book.ability'),
    hint: t('explore.book.abilityHint'),
    unanswered: t('explore.book.abilityUnanswered'),
    options: ABILITIES.map((level) => ({
      value: level,
      label: t(`explore.book.ability${level}`),
    })),
  }
}
