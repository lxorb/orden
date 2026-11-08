import { hiddenKinds } from '../settings.svelte'
import { protection } from './protection.svelte'

export const PROTECTION_WORD = 'shown-protection'
export const NO_PROTECTION_WORD = 'hidden-protection'

export function protectionIn(words: readonly string[]): boolean {
  if (words.includes(PROTECTION_WORD)) return true
  return !words.includes(NO_PROTECTION_WORD) && protection.any
}

export function protectionOn(): boolean {
  return !__EVEN_PLUGIN__ && protectionIn(hiddenKinds.hidden)
}
