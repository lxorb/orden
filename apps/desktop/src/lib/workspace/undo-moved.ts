/** What a move nobody here will undo in its turn does to the steps of undo (undo.svelte.ts):
 *  the stack holds paths. Fetched with the first such move.
 *
 *  A move can be heard that was this window's own: the watch says back what the workspace
 *  did, and through the window that hears it, to this one. Those must change nothing, or a
 *  rename's step reads `y.md` to `y.md` and its undo does nothing. No list of moves said
 *  needs keeping for that, with a length and an age to get wrong: what has to be kept whole
 *  is the steps, and they say what they did. A move no step on the stack did has no step to
 *  spoil; one pushed off it has nothing left to protect. */

import { movedTo } from '../space-paths'
import { landing } from '../views/moving'
import type { FileOp } from './file-ops'
import type { FileAction } from './undo.svelte'

/** Whether a step did this move, or a step is what this move took back. */
function did(action: FileAction, from: string, to: string): boolean {
  if (action.kind === 'many') return action.steps.some((one) => did(one, from, to))
  if (action.kind !== 'move' && action.kind !== 'rename') return false
  return (action.from === from && action.to === to) || (action.from === to && action.to === from)
}

/** A move heard, or a space's. A move under way here is told in its own time, with its step. */
export function heardMove(steps: readonly FileAction[], op: Extract<FileOp, { op: 'moved' }>) {
  const own =
    op.kind !== 'space' && (landing(op.to) || steps.some((one) => did(one, op.from, op.to)))
  if (own) return
  for (const action of steps) rewritten(action, op.from, op.to)
}

/** Every path a step holds, where it is after a move: in place, since what offers to undo
 *  a step knows it by itself. */
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
