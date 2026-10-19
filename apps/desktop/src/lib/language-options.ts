/** The language list as the Language row in the settings offers it.
 *
 *  Each row says for itself whether its catalogue was written in one pass and never
 *  read through, in the same sentence the settings caption says it in. The caption
 *  is about the language already chosen, which is the one row nobody in the list is
 *  choosing; a reader deciding between forty of them can only read it here. */

import { LANGUAGES, t } from './i18n.svelte'

/** What a machine-written catalogue says about itself. Two readers of the one
 *  sentence: the mark on every such row in the list, and the caption under the row
 *  once one of them is the language in force. */
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
