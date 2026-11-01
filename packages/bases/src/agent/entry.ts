/** What quick add writes, and where in a note it goes. Pure: the words in, the edit
 *  out, so quick add's sheet and window, the reader's other ways in (a share, the
 *  glasses) and an agent's `add_task` on both servers write one line one way
 *  (docs/tasks.md 5.6, 5.15).
 *
 *  A task lands at the end of its note, or at the end of the section a `/Heading`
 *  names, written as one more item of the list it joins where the note ends in one and
 *  as a list of its own after a blank line where it does not. A heading the note does
 *  not have yet is made at its end. A description is the first indented paragraph
 *  under the task, as 5.1 has it. */

import type { TextEdit } from '@orden/markdown/edits'
import { CodeBlocks, WORDS } from '@orden/markdown/fences'
import { frontMatterBlock } from '@orden/markdown/front-matter'
import { taskLine } from '@orden/markdown/task-edits'
import type { TaskFields } from '@orden/markdown/task-line'
import type { QuickFields } from '../language/parse'

/** One task, as the reader typed it and the grammar read it. */
export interface Entry {
  text: string
  fields: QuickFields
  /** The lines Shift+Enter opened under it. */
  description?: string
  /** `>Note`, as written. */
  note?: string
  /** `/Heading`. */
  heading?: string
}

/** The task's fields as a whole line holds them. */
export function taskOf(entry: Entry): TaskFields {
  const { fields } = entry
  const task: TaskFields = {
    text: entry.text,
    status: ' ',
    done: false,
    cancelled: false,
    remind: fields.remind,
    priority: fields.priority ?? 4,
    tags: fields.tags,
    dependsOn: [],
    fields: {},
  }
  // A task's date is the day it starts (#371).
  if (fields.due !== undefined) task.start = fields.due
  if (fields.time !== undefined) task.time = fields.time
  if (fields.recurrence !== undefined) task.recurrence = fields.recurrence
  if (fields.assignee !== undefined) task.assignee = fields.assignee
  if (fields.deadline !== undefined) task.deadline = fields.deadline
  if (fields.duration !== undefined) task.duration = fields.duration
  return task
}

/** The task line, and its description indented under it. */
export function linesOf(entry: Entry): string[] {
  const words = (entry.description ?? '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, all) => line !== '' || (index > 0 && index < all.length - 1))
  return [taskLine(taskOf(entry)), ...words.map((line) => (line === '' ? '' : `  ${line}`))]
}

/** Where the lines go: an insertion into the note, and the line the task is on after
 *  it, counting from zero. */
export interface Placed {
  at: number
  insert: string
  line: number
}

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t#]*$/
const ITEM = /^(?:[-*+]|\d+[.)])[ \t]/

/** For each line of a note, its heading's level and words, or null for a line that is
 *  none: a `# comment` in a fenced block or in the front matter is code and YAML, and
 *  a task put under it would be code too, gone from every view. Code as the page reads
 *  it (`CodeBlocks`), so a block closes on its own mark only. */
function headingsOf(
  note: string,
  all: readonly string[],
): ({ level: number; text: string } | null)[] {
  const block = frontMatterBlock(note)
  const wordsFrom = block ? note.slice(0, block.close).split('\n').length : 0
  const code = new CodeBlocks()
  return all.map((line, index) => {
    if (index < wordsFrom || code.line(line) !== WORDS) return null
    const found = HEADING.exec(line)
    return found ? { level: found[1]?.length ?? 1, text: found[2] ?? '' } : null
  })
}

/** Whether the run of lines ending at `last` (a run being the lines since the blank
 *  line above) is a list a new item can join. */
function endsInList(lines: readonly string[], first: number, last: number): boolean {
  for (let index = last; index >= first; index--) {
    const line = lines[index] ?? ''
    if (line.trim() === '') return false
    if (ITEM.test(line)) return true
    // An indented line is a description or a sub-item; the item it belongs to is above.
    if (!/^[ \t]/.test(line)) return false
  }
  return false
}

/** The last line of a span that has words on it, or -1. */
function lastWords(lines: readonly string[], first: number, end: number): number {
  for (let index = end - 1; index >= first; index--) {
    if ((lines[index] ?? '').trim() !== '') return index
  }
  return -1
}

/** Where the lines go in a note: at the end, or at the end of a heading's section. */
export function placeIn(note: string, lines: readonly string[], heading?: string): Placed {
  const eol = note.includes('\r\n') ? '\r\n' : '\n'
  const all = note.split(/\r?\n/)
  const offsets: number[] = []
  let offset = 0
  for (const line of all) {
    offsets.push(offset)
    offset += line.length + eol.length
  }
  const endOf = (index: number) => (offsets[index] ?? 0) + (all[index]?.length ?? 0)
  const block = lines.join(eol)

  let first = 0
  let end = all.length
  if (heading !== undefined) {
    const wanted = heading.trim().toLowerCase()
    const headings = headingsOf(note, all)
    const at = headings.findIndex((one) => one?.text.toLowerCase() === wanted)
    if (at === -1) {
      const last = lastWords(all, 0, all.length)
      const opening = `## ${heading.trim()}`
      if (last === -1) return { at: 0, insert: `${opening}${eol}${block}${eol}`, line: 1 }
      return { at: endOf(last), insert: `${eol}${eol}${opening}${eol}${block}`, line: last + 3 }
    }
    const level = headings[at]?.level ?? 1
    first = at + 1
    const next = headings.findIndex((one, index) => index > at && (one?.level ?? 7) <= level)
    end = next === -1 ? all.length : next
    const last = lastWords(all, first, end)
    if (last === -1) return { at: endOf(at), insert: `${eol}${block}`, line: at + 1 }
    const joins = endsInList(all, first, last)
    return {
      at: endOf(last),
      insert: joins ? `${eol}${block}` : `${eol}${eol}${block}`,
      line: last + (joins ? 1 : 2),
    }
  }

  const last = lastWords(all, first, end)
  if (last === -1) return { at: 0, insert: `${block}${eol}`, line: 0 }
  const joins = endsInList(all, first, last)
  return {
    at: endOf(last),
    insert: joins ? `${eol}${block}` : `${eol}${eol}${block}`,
    line: last + (joins ? 1 : 2),
  }
}

/** Where the lines go, as the edit that puts them there. */
export function placedEdit(placed: Placed): TextEdit {
  return { from: placed.at, to: placed.at, insert: placed.insert }
}
