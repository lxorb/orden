import type { ClipboardClear, Pause, RelockAfter } from './settings'

export function relockWord(after: RelockAfter): string {
  if (after === 0) return 'When Orden closes'
  return after === 1 ? '1 minute' : `${after} minutes`
}

export function clearWord(after: ClipboardClear): string {
  if (after === 0) return 'Never'
  if (after < 60) return `${after} seconds`
  return after === 60 ? '1 minute' : `${after / 60} minutes`
}

export function pauseWord(pause: Pause): string {
  return {
    autofill: 'Autofill',
    totp: 'Autofill 2FA codes',
    suggest: 'Suggestions',
    save: 'Offer to save logins',
    passkeys: 'Passkeys',
    autoLogin: 'Sign in automatically',
  }[pause]
}
