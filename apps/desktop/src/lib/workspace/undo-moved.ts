import { movedTo } from '../space-paths'
import { landing } from '../views/moving'
import type { FileOp } from './file-ops'
import type { FileAction } from './undo.svelte'

function did(action: FileAction, from: string, to: string): boolean {
  if (action.kind === 'many') return action.steps.some((one) => did(one, from, to))
  if (action.kind !== 'move' && action.kind !== 'rename') return false
  return (action.from === from && action.to === to) || (action.from === to && action.to === from)
}

export function heardMove(steps: readonly FileAction[], op: Extract<FileOp, { op: 'moved' }>) {
  const own =
    op.kind !== 'space' && (landing(op.to) || steps.some((one) => did(one, op.from, op.to)))
  if (own) return
  for (const action of steps) rewritten(action, op.from, op.to)
}

export function rewritten(action: FileAction, from: string, to: string) {
  const at = (path: string) => movedTo(path, from, to) ?? path
  switch (action.kind) {
    case 'move':
    case 'rename':
      action.from = at(action.from)
      action.to = at(action.to)
      break
    case 'delete':
      if (action.trashId && at(action.path) !== action.path) {
        action.trashedAt ??= { path: action.path, root: from }
      }
      action.path = at(action.path)
      for (const note of action.notes ?? []) note.path = at(note.path)
      if (action.folders) action.folders = action.folders.map(at)
      break
    case 'create':
      action.path = at(action.path)
      break
    case 'many':
      for (const step of action.steps) rewritten(step, from, to)
      break
    case 'keep':
      action.root = at(action.root)
      break
    case 'merge':
      action.from = at(action.from)
      action.into = at(action.into)
      if (action.relinked) action.relinked = action.relinked.map(at)
      break
    case 'split':
    case 'extract':
      action.from = at(action.from)
      action.created = at(action.created)
      break
    case 'replace':
      for (const note of action.notes) note.path = at(note.path)
      break
    case 'import':
      action.paths = action.paths.map(at)
      action.wrote = Object.fromEntries(
        Object.entries(action.wrote).map(([path, hash]) => [at(path), hash]),
      )
      break
    case 'copy':
      for (const one of action.made) {
        one.path = at(one.path)
        if (one.from !== undefined) one.from = at(one.from)
      }
      break
    case 'archive':
    case 'unarchive':
      action.root = at(action.root)
      action.archived = action.archived.map(at)
      action.restored = action.restored.map(at)
      action.closed = action.closed.map(at)
      break
  }
}
