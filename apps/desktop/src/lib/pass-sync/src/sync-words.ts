import type { PassSyncState } from './syncing.svelte'

export function syncWord(state: PassSyncState): string | null {
  switch (state) {
    case 'off':
      return null
    case 'syncing':
      return 'Syncing…'
    case 'synced':
      return 'Synced'
    case 'offline':
      return 'Offline'
    case 'old-server':
      return 'This account’s server does not have Pass yet'
    case 'conflict':
      return 'This account already has a Pass'
    case 'other-account':
      return 'This Pass belongs to another account'
  }
}
