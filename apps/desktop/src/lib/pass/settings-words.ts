import type { ClipboardClear, Pause, RelockAfter } from './settings'
import { plural, t } from '../i18n.svelte'

export function relockWord(after: RelockAfter): string {
  if (after === 0) return t('When Orden closes')
  return plural(after, { one: '{count} minute', other: '{count} minutes' })
}

export function clearWord(after: ClipboardClear): string {
  if (after === 0) return t('Never')
  if (after < 60) return plural(after, { one: '{count} second', other: '{count} seconds' })
  return plural(after / 60, { one: '{count} minute', other: '{count} minutes' })
}

export function pauseWord(pause: Pause): string {
  switch (pause) {
    case 'autofill':
      return t('Autofill')
    case 'totp':
      return t('Autofill 2FA codes')
    case 'suggest':
      return t('Suggestions')
    case 'save':
      return t('Offer to save logins')
    case 'passkeys':
      return t('Passkeys')
    case 'autoLogin':
      return t('Sign in automatically')
  }
}
