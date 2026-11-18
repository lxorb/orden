import type { Vault } from '@orden/pass/types'
import type { Scope, Sort, TypeFilter } from './list'

export function scopeName(scope: Scope, vaults: readonly Vault[]): string {
  switch (scope.kind) {
    case 'all':
      return 'All items'
    case 'trash':
      return 'Trash'
    case 'shared-with-me':
      return 'Shared with me'
    case 'shared-by-me':
      return 'Shared by me'
    case 'vault': {
      const vault = vaults.find((one) => one.id === scope.vault)
      const folder = vault?.folders.find((one) => one.id === scope.folder)
      return folder?.name ?? vault?.name ?? 'Vault'
    }
  }
}

export function filterName(filter: TypeFilter): string {
  return {
    all: 'All',
    login: 'Logins',
    alias: 'Aliases',
    card: 'Cards',
    note: 'Notes',
    identity: 'Identities',
    other: 'Other',
  }[filter]
}

export function sortName(sort: Sort): string {
  return { recent: 'Most recent', title: 'Title A-Z', newest: 'Newest', oldest: 'Oldest' }[sort]
}
