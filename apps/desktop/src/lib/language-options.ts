import { LANGUAGES, t } from './i18n.svelte'

export function machineSaid(): string {
  return t('Machine-translated. Corrections welcome.')
}

export function languageOptions(): { value: string; label: string; note?: string }[] {
  return LANGUAGES.map((one) => ({
    value: one.id,
    label: t(one.name),
    ...(one.machine ? { note: machineSaid() } : {}),
  }))
}
