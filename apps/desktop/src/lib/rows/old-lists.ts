import { INBOX_KEY, INBOX_VALUE } from '@orden/bases/inbox'
import { LIST_KEY, LIST_VALUE, MARKED_KEY, MARKED_VALUE } from '@orden/bases/todo-lists'
import type { SpaceLinks } from '@orden/scan/note'
import type { MetaPatch } from '@orden/sync-core/meta'
import { links } from '../link-index.svelte'
import { log } from '../log'
import { onDisk } from '../on-disk'
import { insideSpace, samePath } from '../space-paths'
import { invoke } from '../tauri'
import type { ItemMetaStore } from '../workspace/item-meta.svelte'
import { chosenInbox, ownInbox } from './inbox'
import { inProjects, projectsOf } from './projects'

export interface Lists {
  readonly itemMeta: ItemMetaStore
  entryAt(path: string): { is_dir: boolean } | null
}

const marking = new Set<string>()
const hearing = new Set<(paths: readonly string[]) => void>()

export function hearOldLists(then: (paths: readonly string[]) => void): () => void {
  hearing.add(then)
  return () => hearing.delete(then)
}

export function keepInboxListed(root: string, workspace: Lists, chose = false): void {
  const own = ownInbox(root)
  const items = workspace.itemMeta.itemsOf(root)
  const others = Object.entries(items)
    .filter(([, meta]) => meta[INBOX_KEY] === INBOX_VALUE)
    .map(([path]) => path)
    .filter((path) => own === null || !samePath(path, own, root))
  const patches: Record<string, MetaPatch> = {}
  if (chose) for (const path of others) patches[path] = { [INBOX_KEY]: null }
  const inbox = own ?? chosenInbox(root)
  if (inbox !== null) {
    const wanted: Record<string, string> = { [LIST_KEY]: LIST_VALUE }
    if (own !== null && (chose || !others.length)) wanted[INBOX_KEY] = INBOX_VALUE
    const had = items[inbox]
    if (Object.entries(wanted).some(([key, value]) => had?.[key] !== value)) patches[inbox] = wanted
  }
  if (Object.keys(patches).length) workspace.itemMeta.setMany(root, patches)
}

let line: Promise<void> = Promise.resolve()

export function markOldListsSoon(root: string, heard: boolean, workspace: Lists): void {
  if (heard) keepInboxListed(root, workspace)
  if (!heard || marking.has(root) || workspace.itemMeta.listsMarked(root)) return
  marking.add(root)
  line = line
    .then(() => markOldLists(root, workspace))
    .catch((error: unknown) => log('warn', `old todo lists not marked: ${String(error)}`))
    .finally(() => marking.delete(root))
}

interface Held {
  notes: readonly string[]
  folder: boolean
}

async function heldIn(root: string, folder: string, workspace: Lists): Promise<Held | null> {
  const there = insideSpace(root, folder)
  if (samePath(links.rootOf(), root)) {
    await links.scanned()
    if (samePath(links.rootOf(), root)) {
      const notes = links.held().map((note) => note.path)
      return { notes, folder: workspace.entryAt(there)?.is_dir === true }
    }
  }
  const found = await invoke<SpaceLinks>('scan_links', { root }).catch(() => null)
  if (!found) return null
  return { notes: found.notes.map((note) => note.path), folder: await onDisk(there) }
}

async function markOldLists(root: string, workspace: Lists): Promise<void> {
  const meta = workspace.itemMeta
  if (meta.listsMarked(root)) return
  const folder = projectsOf(root)
  const held = await heldIn(root, folder, workspace)
  if (held === null || meta.listsMarked(root)) return
  const there = insideSpace(root, folder)
  const done = meta.valueOf(there, MARKED_KEY, root) === MARKED_VALUE
  const unmarked = held.notes
    .filter((relative) => inProjects(root, relative))
    .filter((relative) => meta.valueOf(insideSpace(root, relative), LIST_KEY, root) === null)
  const patches: Record<string, MetaPatch> = {}
  if (!done) {
    for (const relative of unmarked) patches[relative] = { [LIST_KEY]: LIST_VALUE }
    if (held.folder) patches[folder] = { [MARKED_KEY]: MARKED_VALUE }
  }
  meta.setMany(root, patches)
  meta.markListsMarked(root)
  if (!done || !unmarked.length) return
  const paths = unmarked.map((relative) => insideSpace(root, relative))
  for (const one of hearing) one(paths)
}
