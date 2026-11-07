import type { Vault } from '@orden/pass/types'
import { t } from '../i18n.svelte'
import type { Scope, Sort, TypeFilter } from './list'

export function scopeName(scope: Scope, vaults: readonly Vault[]): string {
  switch (scope.kind) {
    case 'all':
      return t('All items')
    case 'trash':
      return t('Trash')
    case 'shared-with-me':
      return t('Shared with me')
    case 'shared-by-me':
      return t('Shared by me')
    case 'vault': {
      const vault = vaults.find((one) => one.id === scope.vault)
      const folder = vault?.folders.find((one) => one.id === scope.folder)
      return folder?.name ?? vault?.name ?? t('Vault')
    }
  }
}

export function filterName(filter: TypeFilter): string {
  switch (filter) {
    case 'all':
      return t('All')
    case 'login':
      return t('Logins')
    case 'alias':
      return t('Aliases')
    case 'card':
      return t('Cards')
    case 'note':
      return t('Notes')
    case 'identity':
      return t('Identities')
    case 'other':
      return t('Other')
  }
}

export function sortName(sort: Sort): string {
  switch (sort) {
    case 'recent':
      return t('Most recent')
    case 'title':
      return t('Title A-Z')
    case 'newest':
      return t('Newest')
    case 'oldest':
      return t('Oldest')
  }
}
