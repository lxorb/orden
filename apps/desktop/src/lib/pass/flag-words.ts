import type { Flag } from '@orden/pass/monitor'
import { t } from '../i18n.svelte'

export function flagName(flag: Flag): string {
  switch (flag) {
    case 'compromised':
      return t('Compromised passwords')
    case 'weak':
      return t('Weak passwords')
    case 'reused':
      return t('Reused passwords')
    case 'inactive2fa':
      return t('Inactive 2FA')
    case 'excluded':
      return t('Excluded items')
  }
}
