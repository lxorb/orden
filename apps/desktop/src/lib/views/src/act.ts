import type { Row } from '@orden/bases'
import { oneEdit } from '@orden/markdown/edits'
import { rows } from '../../rows/rows.svelte'
import { changed, type RowChange } from '../../rows/write'
import { type Change, changeOf } from '@orden/scan/search/replace'
import { insideSpace } from '../../platform/src/api'
import { workspace } from '../../workspace.svelte'
import { noteText, replaceInNotes } from '../../workspace/note-text'
import { type Said, undoToast } from '../../undo-toast.svelte'
import type { Drop } from './drop'

function pathOf(row: Row): string | null {
  const space = workspace.spaces.find((one) => one.name === row.space)
  return space ? insideSpace(space.root, row.path) : null
}

async function rewrite(path: string, after: (before: string) => string | null): Promise<boolean> {
  const before = await noteText(workspace, path)
  if (before === null) return false
  const next = after(before)
  if (next === null) return false
  const edit = oneEdit(before, next)
  if (!edit) return false
  return replaced([changeOf(path, before, [edit])])
}

async function replaced(changes: readonly Change[], said?: Said): Promise<boolean> {
  if (!(await replaceInNotes(workspace, changes))) return false
  const last = workspace.undone.last
  if (said && last) undoToast.tell(last, said, workspace.undone.stack)
  return true
}

export async function asOneUndo(steps: readonly (() => Promise<unknown>)[]): Promise<void> {
  let made = 0
  for (const step of steps) {
    const top = workspace.undone.stack.at(-1)
    const said = await step()
    if (workspace.undone.stack.at(-1) !== top) made++
    if (said === false) break
  }
  if (made < 2) return
  const { gatherLast } = await import('../../workspace/undo-join')
  for (; made > 1; made--) if (!gatherLast(workspace.undone)) return
}

export function writeRow(row: Row, change: RowChange): Promise<boolean> {
  return rows.write(row, change)
}

export async function writeEach(
  pairs: readonly { row: Row; change: RowChange }[],
  join = false,
  said?: Said,
): Promise<boolean> {
  const byNote = new Map<string, { row: Row; change: RowChange }[]>()
  for (const pair of pairs) {
    const path = pathOf(pair.row)
    if (path !== null) {
      const gathered = byNote.get(path)
      if (gathered) gathered.push(pair)
      else byNote.set(path, [pair])
    }
  }

  const changes = []
  for (const [path, inNote] of byNote) {
    const before = await noteText(workspace, path)
    if (before === null) continue
    let after = before
    for (const { row, change } of inNote) after = changed(after, row, change) ?? after
    const edit = oneEdit(before, after)
    if (edit) changes.push(changeOf(path, before, [edit]))
  }
  if (!changes.length) return false
  if (!(await replaced(changes, said))) return false
  if (join) (await import('../../workspace/undo-join')).joinLast(workspace.undone)
  return true
}

export function dropRow(row: Row, drop: Drop): Promise<boolean> {
  return writeRow(row, drop.change)
}

export async function pressRow(row: Row, change: RowChange): Promise<boolean> {
  const path = pathOf(row)
  if (path === null) return false
  return rewrite(path, (before) =>
    Object.keys(change.note ?? {}).length ? changed(before, row, change) : before,
  )
}
