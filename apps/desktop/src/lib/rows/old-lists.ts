import { LIST_KEY, LIST_VALUE, MARKED_KEY, MARKED_VALUE } from '@orden/bases/todo-lists'
import type { MetaPatch } from '@orden/sync-core/meta'
import { links } from '../link-index.svelte'
import { log } from '../log'
import { insideSpace, relativeTo, samePath } from '../space-paths'
import type { ItemMetaStore } from '../workspace/item-meta.svelte'
import { chosenInbox } from './inbox'
import { inProjects, projectsOf } from './projects'

export interface Lists {
  readonly itemMeta: ItemMetaStore
  readonly notes: readonly { path: string }[]
  entryAt(path: string): { is_dir: boolean } | null
}

const marking = new Set<string>()
const hearing = new Set<(paths: readonly string[]) => void>()

export function hearOldLists(then: (paths: readonly string[]) => void): () => void {
  hearing.add(then)
  return () => hearing.delete(then)
}

export function keepInboxListed(root: string, workspace: Lists): void {
  const inbox = chosenInbox(root)
  if (inbox === null) return
  const path = insideSpace(root, inbox)
  if (workspace.itemMeta.valueOf(path, LIST_KEY, root) === LIST_VALUE) return
  workspace.itemMeta.set(path, { [LIST_KEY]: LIST_VALUE }, root)
}

export function markOldListsSoon(root: string, heard: boolean, workspace: Lists): void {
  if (heard) keepInboxListed(root, workspace)
  if (!heard || marking.has(root) || workspace.itemMeta.listsMarked(root)) return
  marking.add(root)
  void markOldLists(root, workspace)
    .catch((error: unknown) => log('warn', `old todo lists not marked: ${String(error)}`))
    .finally(() => marking.delete(root))
}

async function markOldLists(root: string, workspace: Lists): Promise<void> {
  await links.scanned()
  const meta = workspace.itemMeta
  if (!samePath(links.rootOf(), root) || meta.listsMarked(root)) return
  const folder = projectsOf(root)
  const there = insideSpace(root, folder)
  const done = meta.valueOf(there, MARKED_KEY, root) === MARKED_VALUE
  const unmarked = workspace.notes
    .map((note) => relativeTo(root, note.path))
    .filter((relative) => inProjects(root, relative))
    .filter((relative) => meta.valueOf(insideSpace(root, relative), LIST_KEY, root) === null)
  const patches: Record<string, MetaPatch> = {}
  if (!done) {
    for (const relative of unmarked) patches[relative] = { [LIST_KEY]: LIST_VALUE }
    if (workspace.entryAt(there)?.is_dir) patches[folder] = { [MARKED_KEY]: MARKED_VALUE }
  }
  meta.setMany(root, patches)
  meta.markListsMarked(root)
  if (!done || !unmarked.length) return
  const paths = unmarked.map((relative) => insideSpace(root, relative))
  for (const one of hearing) one(paths)
}
