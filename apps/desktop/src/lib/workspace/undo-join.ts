import { oneEdit } from '@orden/markdown/edits'
import { reverse } from '../search/replace'
import { samePath } from '../platform/src/api'
import type { FileAction, FileActions } from './undo.svelte'

type Replaced = Extract<FileAction, { kind: 'replace' }>['notes'][number]

export function joinedAction(
  earlier: FileAction | undefined,
  notes: readonly Replaced[],
): FileAction | null {
  if (earlier?.kind !== 'replace') return null
  const next = [...earlier.notes]
  for (const note of notes) {
    const at = next.findIndex((one) => samePath(one.path, note.path))
    const was = next[at]
    if (was?.after !== note.content) return null
    const edit = oneEdit(was.content, note.after)
    next[at] = {
      path: was.path,
      content: was.content,
      after: note.after,
      edits: edit ? reverse(was.content, [edit]) : [],
    }
  }
  return { kind: 'replace', notes: next }
}

export function joinLast(undone: FileActions): boolean {
  const last = undone.stack.at(-1)
  if (last?.kind !== 'replace') return false
  const action = joinedAction(undone.stack.at(-2), last.notes)
  if (!action) return false
  undone.stack = [...undone.stack.slice(0, -2), action]
  return true
}

export function gatheredAction(
  earlier: FileAction | undefined,
  notes: readonly Replaced[],
): FileAction | null {
  if (earlier?.kind !== 'replace') return null
  const mine = notes.filter((note) => earlier.notes.some((one) => samePath(one.path, note.path)))
  const joined = joinedAction(earlier, mine)
  if (joined?.kind !== 'replace') return null
  const rest = notes.filter((note) => !mine.includes(note))
  return { kind: 'replace', notes: [...joined.notes, ...rest] }
}

export function gatherLast(undone: FileActions): boolean {
  const last = undone.stack.at(-1)
  if (last?.kind !== 'replace') return false
  const action = gatheredAction(undone.stack.at(-2), last.notes)
  if (!action) return false
  undone.stack = [...undone.stack.slice(0, -2), action]
  return true
}
