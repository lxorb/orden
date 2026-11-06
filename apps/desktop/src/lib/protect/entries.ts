import { t } from '../i18n.svelte'
import type { MenuItem } from '../menu-item'
import { samePath, within } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { unlocks } from './unlocked.svelte'

const unlocking = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('nothing is protected in the Even Realities plugin'))
    : import('./unlocking')

export interface ProtectRow extends MenuItem {
  id: 'protect' | 'unprotect' | 'lock' | 'lock-all'
  run: () => void
}

function rootOf(path: string): string | null {
  return workspace.spaces.find((one) => within(one.root, path) !== null)?.root ?? null
}

export function protectEntries(path: string | null | undefined): ProtectRow[] {
  if (__EVEN_PLUGIN__ || !path) return []
  const root = rootOf(path)
  if (root === null) return []
  const locks = workspace.protection.covering(path)
  const lock: ProtectRow[] =
    locks.length && !unlocks.shut(locks)
      ? [{ id: 'lock', label: t('Lock'), run: () => unlocks.close(locks) }]
      : []
  if (workspace.protection.own(root, path)) {
    return [
      ...lock,
      {
        id: 'unprotect',
        label: t('Remove protection'),
        run: () => void unlocking().then((one) => one.unprotect(root, path)),
      },
    ]
  }
  if (locks.length) return lock
  return [
    {
      id: 'protect',
      label: samePath(root, path) ? t('Protect space') : t('Protect'),
      run: () => void unlocking().then((one) => one.protect(root, path)),
    },
  ]
}

export function lockAllEntry(): ProtectRow[] {
  return unlocks.any
    ? [{ id: 'lock-all', label: t('Lock protected items'), run: () => unlocks.lockAll() }]
    : []
}
