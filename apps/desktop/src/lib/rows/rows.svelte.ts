import type { Row } from '@orden/bases'
import { untrack } from 'svelte'
import { breathe } from '../breathe'
import { links } from '../link-index.svelte'
import type { SpaceLinks } from '@orden/scan/note'
import { insideSpace } from '../space-paths'
import { invoke } from '../tauri'
import { workspace } from '../workspace.svelte'
import { keeping } from '../workspace/file-ops'
import { hearInboxChosen, INBOX, inboxes, inboxOf } from './inbox'
import { projectFolders } from './projects'
import { inboxNote } from './inbox-note'
import { hearOldLists, keepInboxListed } from './old-lists'
import { homeRoot } from './home.svelte'
import { type RowsListener, RowsStore } from './store'
import { listedAt } from './todo-lists'
import { isVault } from './vault'
import { type RowChange, writeRow } from './write'

const store = new RowsStore({
  scan: (root) => invoke<SpaceLinks>('scan_links', { root }).catch(() => null),
  read: (path) => invoke<string>('read_note', { path }).catch(() => null),
  open: () => ({
    root: links.rootOf(),
    scanned: () => links.scanned(),
    notes: () => links.held(),
  }),
  breathe,
  now: () => Date.now(),
  own: () => [INBOX],
  vault: isVault,
  meta: (root, path) => workspace.itemMeta.itemsOf(root)[path] ?? null,
  list: (root, path, meta) => listedAt(root, path, meta),
  dated: (root, path, patch) => workspace.itemMeta.set(insideSpace(root, path), patch, root),
})

links.hearSaves((path, content, arrived) => store.saved(path, content, !arrived))
workspace.itemMeta.hear((path) => store.described(path))
hearInboxChosen((root) => {
  keepInboxListed(root, workspace)
  store.again(root)
})
hearOldLists((paths) => {
  for (const path of paths) store.described(path)
})
links.listsBy((root, relative) => listedAt(root, relative))
links.hearIndexed((root, scans) => store.indexed(root, scans))
workspace.fileOps.follow((op) => store.follow(op))
workspace.fileOps.follow(keeping(inboxes))
workspace.fileOps.follow(keeping(projectFolders))

if (!__EVEN_PLUGIN__) {
  let moving: Promise<typeof import('./inbox-moving')> | null = null
  store.watch(
    (change) => void (moving ??= import('./inbox-moving')).then((one) => one.heard(change)),
  )
}

$effect.root(() => {
  $effect(() => {
    const spaces = workspace.shownSpaces.map(({ root, name }) => ({ root, name }))
    untrack(() => store.spacesAre(spaces))
  })
})

if (!__EVEN_PLUGIN__) void import('../views/runner.svelte')

export const rows = {
  of: (space?: string): readonly Row[] => store.of(space),
  shown: (space?: string): readonly Row[] =>
    workspace.protection.any
      ? store.openOf(space, (path) => workspace.protection.locked(path))
      : store.of(space),
  at: (path: string): readonly Row[] => store.at(path),
  watch: (listener: RowsListener): (() => void) => store.watch(listener),
  settled: (listener: () => void): (() => void) => store.settled(listener),
  get ready(): boolean {
    return store.ready
  },

  async write(row: Row, change: RowChange): Promise<boolean> {
    const root = store.rootOf(row)
    if (root === null) return false
    return writeRow(workspace, insideSpace(root, row.path), row, change)
  },

  async inbox(root: string | null = homeRoot()): Promise<string | null> {
    if (root === null) return null
    return inboxNote(root)
  },

  inboxes(): { space: string; path: string }[] {
    return workspace.shownSpaces.map((one) => ({ space: one.name, path: inboxOf(one.root) }))
  },
}
