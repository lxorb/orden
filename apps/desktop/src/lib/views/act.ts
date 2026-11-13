import { finish, skip, tick } from '@orden/bases'
import type { Row, TaskChange } from '@orden/bases'
import { appliedEdits, oneEdit } from '@orden/markdown/edits'
import { blockIds, freeBlockId } from '@orden/markdown/links'
import { taskLine as lineWords } from '@orden/markdown/task-edits'
import type { TaskFields } from '@orden/markdown/task-line'
import { rows } from '../rows/rows.svelte'
import { changed, type RowChange } from '../rows/write'
import type { Change } from '../search/apply'
import { changeOf } from '../search/replace'
import { insideSpace, samePath } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { noteText, replaceInNotes } from '../workspace/note-text'
import { type Said, undoToast } from '../undo-toast.svelte'
import { dayOf, nowOf } from './days'
import type { Drop } from './drop'
import {
  duplicatedBlock,
  indentedBlock,
  lineOfAnchor,
  movedBeside,
  movedBlock,
  editedLines,
  outermost,
  withLines,
  withoutBlock,
} from './lines'
import {
  askedFor,
  editedTask,
  withComment,
  withDescription,
  withoutComment,
  withoutNeedsInput,
  withSubtask,
} from './task-body'

function pathOf(row: Row): string | null {
  const space = workspace.spaces.find((one) => one.name === row.space)
  return space ? insideSpace(space.root, row.path) : null
}

async function rewrite(
  path: string,
  after: (before: string) => string | null,
  said?: Said,
): Promise<boolean> {
  const before = await noteText(workspace, path)
  if (before === null) return false
  const next = after(before)
  if (next === null) return false
  const edit = oneEdit(before, next)
  if (!edit) return false
  return replaced([changeOf(path, before, [edit])], said)
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
  const { gatherLast } = await import('../workspace/undo-join')
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
  if (join) (await import('../workspace/undo-join')).joinLast(workspace.undone)
  return true
}

const ticking = new WeakSet<Row>()

export async function tickRow(row: Row, today = dayOf(new Date())): Promise<boolean> {
  const anchor = row.anchor
  const path = pathOf(row)
  if (!anchor || path === null) return false
  if (ticking.has(row)) return true
  ticking.add(row)
  const ticked = await rewrite(
    path,
    (before) => {
      const line = lineOfAnchor(before, anchor)
      if (line === null) return null
      const edits = tick(before, line, today)
      return edits.length ? appliedEdits(before, edits) : null
    },
    row.task && !row.task.done ? 'done' : undefined,
  )
  if (!ticked) ticking.delete(row)
  return ticked
}

export async function moveRow(row: Row, up: boolean): Promise<boolean> {
  const anchor = row.anchor
  const path = pathOf(row)
  if (!anchor || path === null) return false
  return rewrite(path, (before) => movedBlock(before, anchor, up))
}

export async function moveBeside(row: Row, target: Row, after: boolean): Promise<boolean> {
  const anchor = row.anchor
  const there = target.anchor
  const path = pathOf(row)
  if (
    !anchor ||
    !there ||
    path === null ||
    row.space !== target.space ||
    !samePath(row.path, target.path)
  ) {
    return false
  }
  return rewrite(path, (before) => movedBeside(before, anchor, there, after))
}

function byNote(many: readonly Row[]): Map<string, Anchored[]> {
  const out = new Map<string, Anchored[]>()
  for (const row of many) {
    const path = pathOf(row)
    const anchor = row.anchor
    if (path !== null && anchor) {
      const gathered = out.get(path)
      if (gathered) gathered.push({ row, anchor })
      else out.set(path, [{ row, anchor }])
    }
  }
  return out
}

interface Anchored {
  row: Row
  anchor: { line: number; hash: string }
}

async function rewriteEach(
  many: readonly Row[],
  after: (before: string, inNote: Anchored[]) => string,
  said?: Said,
): Promise<boolean> {
  const changes = []
  for (const [path, inNote] of byNote(many)) {
    const before = await noteText(workspace, path)
    if (before === null) continue
    const edit = oneEdit(before, after(before, inNote))
    if (edit) changes.push(changeOf(path, before, [edit]))
  }
  if (!changes.length) return false
  return replaced(changes, said)
}

export async function tickRows(asked: readonly Row[], today = dayOf(new Date())): Promise<boolean> {
  const open = (row: Row) => !!row.task && !row.task.done && !row.task.cancelled
  const opening = asked.some(open)
  const many = asked.filter((row) => !ticking.has(row) && (!opening || open(row)))
  if (!many.length) return asked.length > 0
  for (const row of many) ticking.add(row)
  const ticked = await rewriteEach(
    many,
    (before, inNote) => {
      let text = before
      const upward = [...inNote].sort((a, b) => b.anchor.line - a.anchor.line)
      for (const { anchor } of upward) {
        const line = lineOfAnchor(text, anchor)
        const edits = line === null ? [] : tick(text, line, today)
        if (edits.length) text = appliedEdits(text, edits)
      }
      return text
    },
    opening ? 'done' : undefined,
  )
  if (!ticked) for (const row of many) ticking.delete(row)
  return ticked
}

function editLines(
  many: readonly Row[],
  edit: (line: string) => { from: number; to: number; insert: string }[],
  said?: Said,
): Promise<boolean> {
  return rewriteEach(
    many,
    (before, inNote) =>
      editedLines(
        before,
        inNote.map((one) => one.anchor),
        edit,
      ),
    said,
  )
}

export function skipRows(many: readonly Row[], today = dayOf(new Date())): Promise<boolean> {
  const repeating = many.filter((row) => row.task?.recurrence)
  return editLines(repeating, (line) => skip(line, today), 'scheduled')
}

export function finishRows(many: readonly Row[]): Promise<boolean> {
  const repeating = many.filter((row) => row.task?.recurrence)
  return editLines(repeating, (line) => finish(line), 'done')
}

export function deleteRows(many: readonly Row[]): Promise<boolean> {
  return rewriteEach(
    many,
    (before, inNote) =>
      outermost(before, inNote).reduce(
        (text, { anchor }) => withoutBlock(text, anchor) ?? text,
        before,
      ),
    'deleted',
  )
}

export function duplicateRows(many: readonly Row[]): Promise<boolean> {
  return rewriteEach(many, (before, inNote) =>
    outermost(before, inNote).reduce(
      (text, { anchor }) => duplicatedBlock(text, anchor) ?? text,
      before,
    ),
  )
}

export async function linkToRow(row: Row): Promise<string | null> {
  const anchor = row.anchor
  const path = pathOf(row)
  if (!anchor || path === null) return null
  const note = row.path.replace(/\.md$/i, '')
  if (row.task?.block) return `[[${note}#^${row.task.block}]]`

  const before = await noteText(workspace, path)
  if (before === null) return null
  const id = freeBlockId(new Set(blockIds(before).map((one) => one.id)))
  const after = changed(before, row, { task: { block: id } })
  if (after === null) return null
  const edit = oneEdit(before, after)
  if (edit && !(await replaceInNotes(workspace, [changeOf(path, before, [edit])]))) return null
  return `[[${note}#^${id}]]`
}

export async function indentRow(row: Row, deeper: boolean): Promise<boolean> {
  const anchor = row.anchor
  const path = pathOf(row)
  if (!anchor || path === null) return false
  return rewrite(path, (before) => indentedBlock(before, anchor, deeper))
}

export function dropRow(row: Row, drop: Drop): Promise<boolean> {
  if ('tick' in drop) return tickRow(row)
  return writeRow(row, drop.change)
}

export async function addTask(
  path: string,
  fields: Partial<TaskFields> & { text: string },
): Promise<boolean> {
  const line = lineWords(
    {
      status: ' ',
      done: false,
      cancelled: false,
      remind: [],
      priority: 4,
      tags: [],
      dependsOn: [],
      fields: {},
      ...fields,
    },
    '- ',
  )
  return rewrite(path, (before) => withLines(before, [line]))
}

export async function pressRow(row: Row, change: RowChange, task?: string): Promise<boolean> {
  const path = pathOf(row)
  if (path === null) return false
  return rewrite(path, (before) => {
    const set = Object.keys(change.note ?? {}).length ? changed(before, row, change) : before
    if (set === null) return null
    return task?.trim() ? withLines(set, [`- [ ] ${task.trim()}`]) : set
  })
}
export function describe(
  path: string,
  anchor: { line: number; hash: string },
  words: string,
): Promise<boolean> {
  return rewrite(path, (before) => withDescription(before, anchor, words))
}

export async function addSubtask(row: Row, line: string): Promise<boolean> {
  const anchor = row.anchor
  const path = pathOf(row)
  if (!anchor || path === null) return false
  return rewrite(path, (before) => withSubtask(before, anchor, line))
}

export async function addComment(row: Row, words: string): Promise<boolean> {
  const anchor = row.anchor
  const path = pathOf(row)
  if (!anchor || path === null) return false
  const stamp = nowOf(new Date()).slice(0, 16)
  return rewrite(path, (before) => {
    const commented = withComment(before, anchor, words, stamp)
    return commented === null ? null : withoutNeedsInput(commented, anchor)
  })
}

export async function leaveAsked(row: Row, words: string): Promise<boolean> {
  const anchor = row.anchor
  const path = pathOf(row)
  if (!anchor || path === null) return false
  const stamp = nowOf(new Date()).slice(0, 16)
  return rewrite(path, (before) => askedFor(before, anchor, words, stamp))
}

export async function deleteComment(row: Row, line: number): Promise<boolean> {
  const anchor = row.anchor
  const path = pathOf(row)
  if (!anchor || path === null) return false
  return rewrite(path, (before) => withoutComment(before, anchor, line))
}

export async function editTask(
  row: Row,
  change: TaskChange,
  description: string | null,
): Promise<boolean> {
  const path = pathOf(row)
  if (path === null) return false
  return rewrite(path, (before) => editedTask(before, row, change, description))
}
