/** What a view does to the notes its rows are in: a box ticked, a cell written, a card
 *  dropped, a line moved, a task added. Every one of them is one write of the notes it
 *  touches, through note-text.ts, so it is one thing to undo and every pane showing
 *  the note has it at once; and every one of them reaches the rows the way any save
 *  does, so the view that did it moves with the rest (docs/tasks.md 5.12).
 *
 *  A property or a field goes through `rows.write`, the one write path. A tick goes
 *  through the engine's `tick`, which writes a recurring task's next occurrence in the
 *  same edit, as the editor's box does. A move of whole lines is this lane's own, in
 *  lines.ts. */

import { taskHash, tick } from '@nib/bases'
import type { Row, TaskChange } from '@nib/bases'
import { appliedEdits, oneEdit } from '@nib/markdown/edits'
import { blockIds, freeBlockId } from '@nib/markdown/links'
import { taskLine as lineWords } from '@nib/markdown/task-edits'
import type { TaskFields } from '@nib/markdown/task-line'
import { rows } from '../rows/rows.svelte'
import { changed, type RowChange } from '../rows/write'
import type { Change } from '../search/apply'
import { changeOf } from '../search/replace'
import { insideSpace, samePath } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { noteText, replaceInNotes } from '../workspace/note-text'
import { type Said, undoToast } from '../undo-toast.svelte'
import { dayOf } from './days'
import type { Drop } from './drop'
import {
  cutBlock,
  duplicatedBlock,
  indentedBlock,
  lineOfAnchor,
  movedBeside,
  movedBlock,
  movedUnder,
  outermost,
  withLines,
  withoutBlock,
} from './lines'
import { withDescription, withSubtask } from './task-body'

/** Where a row's note is on this disk, or null for a space no longer here. */
function pathOf(row: Row): string | null {
  const space = workspace.spaces.find((one) => one.name === row.space)
  return space ? insideSpace(space.root, row.path) : null
}

/** One note written from what it said to what it says now; false where nothing
 *  changed or the note could not be read. `said` is what the undo toast calls it. */
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
  await replaced([changeOf(path, before, [edit])], said)
  return true
}

/** A write of notes, as one undo; `said` is the word the undo toast offers it back
 *  under, where it is one a view's tasks were given (undo-toast.svelte.ts). */
async function replaced(changes: readonly Change[], said?: Said): Promise<void> {
  await replaceInNotes(workspace, changes)
  const last = workspace.undone.last
  if (said && last) undoToast.tell(last, said, workspace.undone.stack)
}

/** A property of a row's note or a field of its task: the one write path. */
export function writeRow(row: Row, change: RowChange): Promise<boolean> {
  return rows.write(row, change)
}

/** A change of its own to each of many rows, as one write, so one undo takes all of it
 *  back: Overdue's Reschedule, an option renamed in every note that holds it, ids given
 *  to a base's rows. `join` makes it one undo with the
 *  write just before, where it follows from that one (an automation). */
export async function writeEach(
  pairs: readonly { row: Row; change: RowChange }[],
  join = false,
  said?: Said,
): Promise<boolean> {
  const byNote = new Map<string, { row: Row; change: RowChange }[]>()
  for (const pair of pairs) {
    const path = pathOf(pair.row)
    if (path !== null) byNote.set(path, [...(byNote.get(path) ?? []), pair])
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
  await replaced(changes, said)
  if (join) (await import('../workspace/undo-join')).joinLast(workspace.undone)
  return true
}

/** A task's box pressed: ticked as the editor ticks it, with a recurring task's next
 *  occurrence written above, or opened again when it was done. */
export async function tickRow(row: Row, today = dayOf(new Date())): Promise<boolean> {
  const anchor = row.anchor
  const path = pathOf(row)
  if (!anchor || path === null) return false
  return rewrite(
    path,
    (before) => {
      const line = lineOfAnchor(before, anchor)
      if (line === null) return null
      const edits = tick(before, line, today)
      return edits.length ? appliedEdits(before, edits) : null
    },
    row.task && !row.task.done ? 'done' : undefined,
  )
}

/** Alt+↑ and Alt+↓: the task and everything under it past its sibling. */
export async function moveRow(row: Row, up: boolean): Promise<boolean> {
  const anchor = row.anchor
  const path = pathOf(row)
  if (!anchor || path === null) return false
  return rewrite(path, (before) => movedBlock(before, anchor, up))
}

/** A task dragged onto another of its note's tasks: its lines moved to stand before
 *  (or after) that one's. */
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

/** Many tasks' notes, each with the rows it holds; a row of a space no longer here or
 *  of no line left out. */
function byNote(many: readonly Row[]): Map<string, Anchored[]> {
  const out = new Map<string, Anchored[]>()
  for (const row of many) {
    const path = pathOf(row)
    const anchor = row.anchor
    if (path !== null && anchor) out.set(path, [...(out.get(path) ?? []), { row, anchor }])
  }
  return out
}

interface Anchored {
  row: Row
  anchor: { line: number; hash: string }
}

/** Each note of many tasks rewritten by `after`, as one write: one undo. */
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
  await replaced(changes, said)
  return true
}

/** Many tasks ticked as one write, from the last of each note up, so a recurring task's
 *  next occurrence written above one leaves the lines above it where the anchors say. */
export function tickRows(many: readonly Row[], today = dayOf(new Date())): Promise<boolean> {
  const opening = many.some((row) => row.task && !row.task.done)
  return rewriteEach(
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
}

/** Many tasks deleted as one write, so one undo brings all of them back: the bulk
 *  bar's Delete. Each note is cut from its last task up, so the lines above a cut are
 *  where the anchors say. */
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

/** Tasks written again just under themselves, with everything under them: Duplicate. */
export function duplicateRows(many: readonly Row[]): Promise<boolean> {
  return rewriteEach(many, (before, inNote) =>
    outermost(before, inNote).reduce(
      (text, { anchor }) => duplicatedBlock(text, anchor) ?? text,
      before,
    ),
  )
}

/** Many tasks moved to the end of one note (`target`, on this disk), each with its
 *  lines, in the order they stood: the bulk bar's and the row menu's Move to, and `v`.
 *  The note has to be there. Every note written as one write, so one undo puts all of
 *  them back. */
export async function moveRowsTo(many: readonly Row[], target: string): Promise<boolean> {
  const was = await noteText(workspace, target)
  if (was === null) return false
  let there = was
  const changes = []
  for (const [path, inNote] of byNote(many)) {
    if (samePath(path, target)) continue
    const before = await noteText(workspace, path)
    if (before === null) continue
    let rest = before
    const blocks: string[][] = []
    for (const { anchor } of outermost(before, inNote)) {
      const cut = cutBlock(rest, anchor)
      if (!cut) continue
      rest = cut.rest
      blocks.unshift(cut.block)
    }
    const leave = oneEdit(before, rest)
    if (!leave) continue
    changes.push(changeOf(path, before, [leave]))
    there = withLines(there, blocks.flat())
  }
  const arrive = oneEdit(was, there)
  if (arrive) changes.push(changeOf(target, was, [arrive]))
  if (!changes.length) return false
  await replaced(changes, 'moved')
  return true
}

/** The link to a task, Obsidian's block reference: the task's block name, given it the
 *  first time it is asked for (one edit, `^` and the name at the end of its line), and
 *  `[[Note#^name]]`, which opens the task here and in Obsidian. Null where the task is
 *  not in its note any more. */
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
  if (edit) await replaceInNotes(workspace, [changeOf(path, before, [edit])])
  return `[[${note}#^${id}]]`
}

/** Tab and Shift+Tab: a sub-task of the task above it, or lifted out a level. */
export async function indentRow(row: Row, deeper: boolean): Promise<boolean> {
  const anchor = row.anchor
  const path = pathOf(row)
  if (!anchor || path === null) return false
  return rewrite(path, (before) => indentedBlock(before, anchor, deeper))
}

/** A task's lines moved under another heading of its note, or into another note of
 *  its space (under one of that note's headings, where one is named). Two notes
 *  written as one write, so one undo puts the task back. */
async function moveRowTo(row: Row, to: { path?: string; heading?: string }): Promise<boolean> {
  const anchor = row.anchor
  const from = pathOf(row)
  if (!anchor || from === null) return false

  const target = to.path === undefined ? null : targetOf(row, to.path)
  if (target === null || samePath(target, from)) {
    if (to.heading === undefined) return false
    const heading = to.heading
    return rewrite(from, (before) => movedUnder(before, anchor, heading), 'moved')
  }

  const [before, there] = await Promise.all([
    noteText(workspace, from),
    noteText(workspace, target),
  ])
  if (before === null) return false
  const cut = cutBlock(before, anchor)
  if (!cut) return false
  const after = withLines(there ?? '', cut.block, to.heading)

  const changes = []
  const leave = oneEdit(before, cut.rest)
  const arrive = oneEdit(there ?? '', after)
  if (leave) changes.push(changeOf(from, before, [leave]))
  if (arrive) changes.push(changeOf(target, there ?? '', [arrive]))
  await replaced(changes, 'moved')
  return true
}

/** The note a move names, in the row's own space: by path, or by a note's name, which
 *  is what a view grouped by note calls its groups. */
function targetOf(row: Row, named: string): string | null {
  const space = workspace.spaces.find((one) => one.name === row.space)
  if (!space) return null
  const all = rows.of(row.space)
  const found =
    all.find((one) => one.kind === 'note' && samePath(one.path, named)) ??
    all.find((one) => one.kind === 'note' && one.file.basename === named)
  return found ? insideSpace(space.root, found.path) : null
}

/** What the view does with a drop: the change, the tick or the move it answered. */
export function dropRow(row: Row, drop: Drop): Promise<boolean> {
  if ('tick' in drop) return tickRow(row)
  if ('move' in drop) return moveRowTo(row, drop.move)
  return writeRow(row, drop.change)
}

/** A new task line written at the end of a note, or of one of its headings. `path`
 *  is on this disk. */
export async function addTask(
  path: string,
  fields: Partial<TaskFields> & { text: string },
  heading?: string,
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
  return rewrite(path, (before) => withLines(before, [line], heading))
}

/** A button pressed on a row (docs/tasks.md 5.13): its properties set and its task
 *  added at the end of the row's note, as one write, so one undo takes the press back. */
export async function pressRow(row: Row, change: RowChange, task?: string): Promise<boolean> {
  const path = pathOf(row)
  if (path === null) return false
  return rewrite(path, (before) => {
    const set = Object.keys(change.note ?? {}).length ? changed(before, row, change) : before
    if (set === null) return null
    return task?.trim() ? withLines(set, [`- [ ] ${task.trim()}`]) : set
  })
}
/** A task's description written as these words, under its line and indented to be its
 *  own; the task view's editor, a moment after the typing stops. `path` is on this disk. */
export function describe(
  path: string,
  anchor: { line: number; hash: string },
  words: string,
): Promise<boolean> {
  return rewrite(path, (before) => withDescription(before, anchor, words))
}

/** A sub-task, a whole line already written, at the end of what a task holds. */
export async function addSubtask(row: Row, line: string): Promise<boolean> {
  const anchor = row.anchor
  const path = pathOf(row)
  if (!anchor || path === null) return false
  return rewrite(path, (before) => withSubtask(before, anchor, line))
}

/** A task changed the way the field that edits it says: its line and, where the field
 *  held a description, the words under it, as one edit and so one undo. */
export async function editTask(
  row: Row,
  change: TaskChange,
  description: string | null,
): Promise<boolean> {
  const anchor = row.anchor
  const path = pathOf(row)
  if (!anchor || path === null || !row.task) return false
  const words = change.text ?? row.task.text
  return rewrite(path, (before) => {
    const after = changed(before, row, { task: change }) ?? before
    if (description === null) return after
    return (
      withDescription(after, { line: anchor.line, hash: taskHash(words) }, description) ?? after
    )
  })
}
