import type { Row } from '@orden/bases'
import { untrack } from 'svelte'
import { breathe } from '../breathe'
import { links } from '../link-index.svelte'
import type { SpaceLinks } from '@orden/scan/note'
import { insideSpace, invoke } from '../platform/src/api'
import { workspace } from '../workspace.svelte'
import { readText } from '../workspace/in-turn'
import { type RowsListener, RowsStore } from './store'
import { isVault } from './vault'
import { type RowChange, writeRow } from './write'

const store = new RowsStore({
  scan: (root) => invoke<SpaceLinks>('scan_links', { root }).catch(() => null),
  read: readText,
  open: () => ({
    root: links.rootOf(),
    scanned: () => links.scanned(),
    notes: () => links.held(),
  }),
  breathe,
  now: () => Date.now(),
  vault: isVault,
  meta: (root, path) => workspace.itemMeta.itemsOf(root)[path] ?? null,
  list: () => false,
})

links.hearSaves((path, content) => store.saved(path, content))
workspace.itemMeta.hear((path) => store.described(path))
links.hearIndexed((root, scans) => store.indexed(root, scans))
workspace.fileOps.follow((op) => store.follow(op))

$effect.root(() => {
  $effect(() => {
    const spaces = workspace.shownSpaces.map(({ root, name }) => ({ root, name }))
    untrack(() => store.spacesAre(spaces))
  })
})

if (!__EVEN_PLUGIN__) void import('../views/src/api').then((one) => one.startRunner())

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
}
