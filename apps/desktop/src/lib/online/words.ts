import type { Refusal } from '@orden/online/wire'
import { t } from '../i18n.svelte'
import type { Refused } from './calls'

export function refusalWords(why: Refused | Refusal): string | null {
  switch (why) {
    case 'gone':
      return t('This terminal is gone')
    case 'list':
      return t('Online terminals are not open to your account yet')
    case 'allowance':
      return t('This month’s online hours are used')
    case 'budget':
    case 'off':
      return t('Online terminals are paused for now')
    case 'flag':
      return t('This machine is stopped')
    case 'sessions':
      return t('Your machine has eight terminals already')
    case 'other':
      return t('Could not reach your machine')
    case 'signed-out':
      return t('Sign in to use an online terminal')
    case 'role':
    case 'rate':
    case 'large':
      return null
  }
}
