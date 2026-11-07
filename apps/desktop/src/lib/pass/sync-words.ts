import { t } from '../i18n.svelte'
import type { PassSyncState } from './syncing.svelte'

export function syncWord(state: PassSyncState): string | null {
  switch (state) {
    case 'off':
      return null
    case 'syncing':
      return t('Syncing…')
    case 'synced':
      return t('Synced')
    case 'offline':
      return t('Offline')
    case 'old-server':
      return t('This account’s server does not have Pass yet')
    case 'conflict':
      return t('This account already has a Pass')
    case 'other-account':
      return t('This Pass belongs to another account')
  }
}
