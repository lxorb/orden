import { toArchive, toRestore } from './archive-plan'
import { relativeTo, insideSpace, withinSpace } from './platform/src/api'
import { coveredBy } from './workspace/archive.svelte'
import { changed } from './workspace/archive-map'
import type { FileAction } from './workspace/undo.svelte'
import { workspace } from './workspace.svelte'

type Archiving = Extract<FileAction, { kind: 'archive' | 'unarchive' }>

function place(path: string): { root: string; at: string } | null {
  const root = workspace.activeSpace?.root
  if (!root) return null

  const at = withinSpace(root, path)
  return at ? { root, at } : null
}

export function archive(paths: readonly string[]): void {
  const root = workspace.activeSpace?.root
  if (!root) return

  const at = paths.flatMap((path) => place(path)?.at ?? [])
  const fresh = toArchive(at, workspace.archive.keysOf(root))
  if (fresh.length) done({ kind: 'archive', root, archived: fresh, restored: [], closed: [] })
}

export function unarchive(path: string): void {
  const found = place(path)
  if (!found) return

  const { root, at } = found
  const plan = toRestore(workspace.archive.keysOf(root), at, (folder) => childrenOf(root, folder))
  if (!plan.restore.length) return

  done({ kind: 'unarchive', root, archived: plan.archive, restored: plan.restore, closed: [] })
}

export function archiveAgain(action: Archiving): void {
  done({ ...action, closed: [] })
}

function done(action: Archiving) {
  const map = changed(
    workspace.archive.of(action.root),
    action.archived,
    action.restored,
    Date.now(),
  )
  if (map) workspace.archive.put(action.root, map)
  const closed = action.kind === 'archive' ? closeHidden(action.root) : []
  workspace.undone.record({ ...action, closed })
}

function closeHidden(root: string): string[] {
  const keys = workspace.archive.keysOf(root)
  const hidden = workspace.tabs.filter((tab) => {
    const at = tab.path === null ? null : withinSpace(root, tab.path)
    return at !== null && coveredBy(keys, at) !== null
  })

  for (const tab of hidden) workspace.close(tab.id)
  return [...new Set(hidden.flatMap((tab) => tab.path ?? []))]
}

function childrenOf(root: string, folder: string): string[] {
  const entry = folder ? workspace.entryAt(insideSpace(root, folder)) : workspace.tree
  return (entry?.children ?? []).map((child) => relativeTo(root, child.path))
}
