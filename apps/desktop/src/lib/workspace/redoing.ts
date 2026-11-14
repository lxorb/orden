import { folderOf, nameOf } from '../platform/src/api'
import { copyAgain, type Copies } from './copying'
import type { FileAction } from './undo.svelte'
import { putBack } from './undoing'
import type { Bookmark } from './bookmarks.svelte'

export interface DoesAgain extends Copies {
  move(from: string, intoFolder: string, how?: 'carries'): Promise<void>
  rename(path: string, name: string): Promise<void>
  remove(path: string, isFolder: boolean): Promise<void>
  fileCame(path: string, kind: 'file' | 'folder', key?: string, back?: string): Promise<void>
  readonly bookmarks: { put(root: string, list: Bookmark[]): void }
  loadTree(): Promise<void>
  persist(): void
}

export async function redoLastFileAction(ws: DoesAgain): Promise<void> {
  const action = ws.undone.next
  if (!action) return
  const rest = ws.undone.ahead.slice(0, -1)

  try {
    await ws.undone.batch(() => again(ws, action))
  } catch {
    const { failed } = await import('../failed.svelte')
    failed.tell(() => void redoLastFileAction(ws), true)
    return
  }

  ws.undone.redone(rest)
  await ws.loadTree()
  ws.persist()
}

async function again(ws: DoesAgain, action: FileAction): Promise<void> {
  switch (action.kind) {
    case 'move':
      if (action.follows) break
      if (action.carries) (await import('./moving-space')).followsTo(action.to)
      await ws.move(action.from, folderOf(action.to), action.carries ? 'carries' : undefined)
      if (action.carries) await (await import('./moving-space')).tabsFollow(action.to)
      break
    case 'rename':
      await ws.rename(action.from, nameOf(action.to))
      break
    case 'delete':
      await ws.remove(action.path, action.folder === true)
      break
    case 'create': {
      const path = await putBack({ ...action, kind: 'delete', content: action.content ?? '' })
      await ws.fileCame(path, 'file', undefined, action.back ?? action.trashId)
      ws.undone.record({ kind: 'create', path })
      break
    }
    case 'many':
      for (const step of action.steps) await again(ws, step)
      break
    case 'keep': {
      const { moving } = await import('../list-landing.svelte')
      moving(() => ws.bookmarks.put(action.root, action.after))
      ws.undone.record(action)
      break
    }
    case 'copy':
      await copyAgain(ws, action.made)
      break
    case 'archive':
    case 'unarchive':
      if (!__EVEN_PLUGIN__) (await import('../archiving')).archiveAgain(action)
      break
    case 'outside':
      if (!__EVEN_PLUGIN__) await (await import('../explorer/src/api')).redoOutside(action)
      break
    case 'merge':
    case 'split':
    case 'extract':
    case 'replace':
    case 'import':
      return
  }
}
