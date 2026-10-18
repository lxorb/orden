/** Doing an undone file operation again: the same operation asked for again, so a
 *  move moves, a rename renames, a deletion deletes and a copy copies to where it
 *  landed the first time. Each records itself as it always does, so it is one undo
 *  away again. Which operations can is `doesAgain` in undo.svelte.ts.
 *
 *  Fetched with the first redo, which most windows never ask for. */

import { folderOf, nameOf } from '../space-paths'
import { copyAgain, type Copies } from './copying'
import type { FileAction } from './undo.svelte'
import { putBack } from './undoing'
import type { Bookmark } from './bookmarks.svelte'

/** What doing an undone operation again needs of the store: the operations
 *  themselves, which record themselves as they always do. */
export interface DoesAgain extends Copies {
  move(from: string, intoFolder: string): Promise<void>
  rename(path: string, name: string): Promise<void>
  remove(path: string, isFolder: boolean): Promise<void>
  fileCame(path: string, kind: 'file' | 'folder'): Promise<void>
  readonly bookmarks: { put(root: string, list: Bookmark[]): void }
  loadTree(): Promise<void>
  persist(): void
}

/** Does the last undone file operation again. What was ahead of it stays ahead. */
export async function redoLastFileAction(ws: DoesAgain): Promise<void> {
  const action = ws.undone.next
  if (!action) return
  const rest = ws.undone.ahead.slice(0, -1)

  try {
    // What the steps of one gesture record as they are done again is one step again.
    await ws.undone.batch(() => again(ws, action))
  } catch {
    // Something has taken the place since; the redo stays where it was, to be
    // asked for again.
    return
  }

  ws.undone.redone(rest)
  await ws.loadTree()
  ws.persist()
}

/** Does one operation again. */
async function again(ws: DoesAgain, action: FileAction): Promise<void> {
  switch (action.kind) {
    case 'move':
      // A move the one before it caused comes about again with that one.
      if (!action.follows) await ws.move(action.from, folderOf(action.to))
      break
    case 'rename':
      await ws.rename(action.from, nameOf(action.to))
      break
    case 'delete':
      await ws.remove(action.path, action.folder === true)
      break
    case 'create': {
      // Back out of Recently deleted, or written again from what it said.
      const path = await putBack({ ...action, kind: 'delete', content: action.content ?? '' })
      await ws.fileCame(path, 'file')
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
      // Never in the glasses' plugin, which has no archiving to do again.
      if (!__EVEN_PLUGIN__) (await import('../archiving')).archiveAgain(action)
      break
    // Never ahead: they kept only the way back; see `doesAgain`.
    case 'merge':
    case 'split':
    case 'extract':
    case 'replace':
    case 'import':
      return
  }
}
