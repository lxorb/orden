import { busy } from '../../../ui-kit/src/api'
import type { IconNode } from 'lucide'
import type { MenuItem } from '../../../ui-kit/src/api'
import { samePath, within } from '../../../platform/src/api'
import { workspace } from '../../../workspace.svelte'
import { protectionOn } from './gate'
import { unlocks } from '../../../protect/src/api'

const unlocking = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('nothing is protected in the Even Realities plugin'))
    : import('./unlocking')

const failed = (error: unknown) =>
  busy.failed(`That did not work: ${error instanceof Error ? error.message : String(error)}`)

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
          { id: 'lock', label: 'Lock', run: () => unlocks.close(locks) },
          {
            id: 'agents',
            label: 'Let agents read',
            checked: agents,
            run: () => unlocks.letAgents(locks, !agents),
          },
        ]
      : []
  if (!protectionOn()) return lock
  if (workspace.protection.own(root, path)) {
    return [
      ...lock,
      {
        id: 'unprotect',
        label: 'Remove protection',
        run: () => void unlocking().then((one) => one.unprotect(root, path), failed),
      },
    ]
  }
  if (locks.length) return lock
  return [
    {
      id: 'protect',
      label: samePath(root, path) ? 'Protect space' : 'Protect',
      run: () => void unlocking().then((one) => one.protect(root, path), failed),
    },
  ]
}

export function lockAllEntry(): ProtectRow[] {
  return unlocks.any
    ? [{ id: 'lock-all', label: 'Lock protected items', run: () => unlocks.lockAll() }]
    : []
}
