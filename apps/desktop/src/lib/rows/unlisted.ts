import { isInboxPath } from '@orden/bases/inbox'
import type { MetaPatch } from '@orden/sync-core'
import type { ItemMetaStore } from '../workspace/item-meta.svelte'

const OLD_KEYS = ['todo-list', 'todo-lists', 'done-on', 'cancelled-on']

export function dropListKeys(root: string, meta: Pick<ItemMetaStore, 'itemsOf' | 'setMany'>): void {
  const patches: Record<string, MetaPatch> = {}
  for (const [path, held] of Object.entries(meta.itemsOf(root))) {
    if (isInboxPath(path)) continue
    const gone = OLD_KEYS.filter((key) => held[key] !== undefined)
    if (gone.length) patches[path] = Object.fromEntries(gone.map((key) => [key, null]))
  }
  if (Object.keys(patches).length) meta.setMany(root, patches)
}
