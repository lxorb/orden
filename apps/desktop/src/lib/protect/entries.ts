import { busy } from '../busy.svelte'
import { t } from '../i18n.svelte'
import type { IconNode } from 'lucide'
import type { MenuItem } from '../menu-item'
import { samePath, within } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { unlocks } from './unlocked.svelte'

const unlocking = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('nothing is protected in the Even Realities plugin'))
    : import('./unlocking')

const failed = (error: unknown) =>
  busy.failed(
    t('That did not work: {reason}', {
      reason: error instanceof Error ? error.message : String(error),
    }),
  )

export const LOCK_MARK: IconNode = [
  ['rect', { width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' }],
  ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }],
]

export interface ProtectRow extends MenuItem {
  id: 'protect' | 'unprotect' | 'lock' | 'lock-all' | 'agents'
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
  const agents = unlocks.agentsMay(locks)
  const lock: ProtectRow[] =
    locks.length && !unlocks.shut(locks)
      ? [
          { id: 'lock', label: t('Lock'), run: () => unlocks.close(locks) },
          {
            id: 'agents',
            label: t('Let agents read'),
            checked: agents,
            run: () => unlocks.letAgents(locks, !agents),
          },
        ]
      : []
  if (workspace.protection.own(root, path)) {
    return [
      ...lock,
      {
        id: 'unprotect',
        label: t('Remove protection'),
        run: () => void unlocking().then((one) => one.unprotect(root, path), failed),
      },
    ]
  }
  if (locks.length) return lock
  return [
    {
      id: 'protect',
      label: samePath(root, path) ? t('Protect space') : t('Protect'),
      run: () => void unlocking().then((one) => one.protect(root, path), failed),
    },
  ]
}

export function lockAllEntry(): ProtectRow[] {
  return unlocks.any
    ? [{ id: 'lock-all', label: t('Lock protected items'), run: () => unlocks.lockAll() }]
    : []
}
