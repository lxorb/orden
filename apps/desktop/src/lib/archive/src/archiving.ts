import { toArchive, toRestore } from './archive-plan'
import { relativeTo, insideSpace, withinSpace, coveredBy } from '../../platform/src/api'
import type { FileAction } from '../../file-undo/src/api'
import { workspace } from '../../workspace/src/api'

type Archiving = Extract<FileAction, { kind: 'archive' | 'unarchive' }>

function place(path: string): { root: string; at: string } | null {
  const root = workspace.activeSpace?.root
  if (!root) return null

  const at = withinSpace(root, path)
  return at ? { root, at } : null
}

export async function archive(paths: readonly string[]): Promise<void> {
  const root = workspace.activeSpace?.root
  if (!root) return

  const at = paths.flatMap((path) => place(path)?.at ?? [])
  const fresh = toArchive(at, workspace.archive.keysOf(root))
  if (fresh.length) await done({ kind: 'archive', root, archived: fresh, restored: [], closed: [] })
}

export async function unarchive(path: string): Promise<void> {
  const found = place(path)
  if (!found) return

  const { root, at } = found
  const plan = toRestore(workspace.archive.keysOf(root), at, (folder) => childrenOf(root, folder))
  if (!plan.restore.length) return

  await done({
    kind: 'unarchive',
    root,
    archived: plan.archive,
    restored: plan.restore,
    closed: [],
  })
}

export async function archiveAgain(action: Archiving): Promise<void> {
  await done({ ...action, closed: [] })
}

async function done(action: Archiving) {
  await workspace.archive.change(action.root, action.archived, action.restored)
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
