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
  switch (filter) {
    case 'all':
      return 'All'
    case 'login':
      return 'Logins'
    case 'alias':
      return 'Aliases'
    case 'card':
      return 'Cards'
    case 'note':
      return 'Notes'
    case 'identity':
      return 'Identities'
    case 'other':
      return 'Other'
  }
}

export function sortName(sort: Sort): string {
  switch (sort) {
    case 'recent':
      return 'Most recent'
    case 'title':
      return 'Title A-Z'
    case 'newest':
      return 'Newest'
    case 'oldest':
      return 'Oldest'
  }
}
