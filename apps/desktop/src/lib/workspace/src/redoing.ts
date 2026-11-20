import type { Bookmark } from '@orden/contracts'
import { folderOf, nameOf, samePath } from '../../platform/src/api'
import { copyAgain, type Copies } from './copying'
import type { FileAction } from '../../file-undo/src/api'
import { putBack } from './undoing'
import { services } from './services'
import { titleOf } from './title-name'

export interface DoesAgain extends Copies {
  move(from: string, intoFolder: string, how?: 'carries'): Promise<void>
  rename(path: string, name: string, words?: string): Promise<void>
  remove(path: string, isFolder: boolean): Promise<void>
  fileCame(path: string, kind: 'file' | 'folder', key?: string, back?: string): Promise<void>
  readonly bookmarks: { put(root: string, list: Bookmark[]): void }
  loadTree(): Promise<void>
  persist(): void
}
function wordsOf(next: FileAction | undefined, to: string): string | undefined {
  const note = next?.kind === 'replace' && next.notes.length === 1 ? next.notes[0] : undefined
  return note && samePath(note.path, to) ? titleOf(note.after)?.words : undefined
}
export async function redoLastFileAction(ws: DoesAgain): Promise<void> {
  const action = ws.undone.next
  if (!action) return
  const rest = ws.undone.ahead.slice(0, -1)
  try {
    await ws.undone.batch(() => again(ws, action))
  } catch {
    const { failed } = await import('./notices.svelte')
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
      for (const [at, step] of action.steps.entries()) {
        if (step.kind === 'rename') await ws.rename(step.from, nameOf(step.to), wordsOf(action.steps[at + 1], step.to))
        else await again(ws, step)
      }
      break
    case 'keep': {
      const { moving } = await import('./list-landing.svelte')
      moving(() => ws.bookmarks.put(action.root, action.after))
      ws.undone.record(action)
      break
    }
    case 'copy':
      await copyAgain(ws, action.made)
      break
    case 'archive':
    case 'unarchive':
      await services().archiveAgain(action)
      break
    case 'outside':
      await services().redoOutside(action)
      break
    case 'merge':
    case 'split':
    case 'extract':
    case 'replace':
    case 'import':
      return
  }
}
