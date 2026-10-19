/** What a note gives the rows of its space: its front matter as written, and its task
 *  lines with the headings above them (docs/tasks.md 5.3).
 *
 *  The twin of the same two fields of `scan_links` in links.rs, read the same way:
 *  outside code, below the front matter, every line a task is with the heading path
 *  the walk has come past. Raw rather than parsed, because the rows parse the fields
 *  with the one reader they have (`@nib/bases`), so the crate and the window cannot
 *  disagree about what a date is. The cases in scan.test.ts are the twins of the
 *  crate's.
 *
 *  A task also says what is written under it, as much as a row shows without the note:
 *  the first line of its description and how many comments it has (docs/tasks.md 5.1).
 *
 *  Its own entry, `@nib/bases/scan`, with nothing of the engine behind it, rather
 *  than a part of the app's scan-note.ts, which the first paint carries: nothing
 *  before the launch order is over asks a note for its tasks. The browser's scan
 *  reads it for every note (web/commands.ts), the rows for a note just saved
 *  (rows/store.ts), and the account connector for every note it answers about. */

import { frontMatterBlock } from '@nib/markdown/front-matter'
import { taskAt } from '@nib/markdown/tasks'

/** One task line, as written. */
export interface ScannedTask {
  /** The line it is on, counting from zero. */
  line: number
  /** How far it is indented, in characters: a sub-task is indented under its task. */
  indent: number
  /** What is between the brackets, as written. */
  mark: string
  /** Everything after the box, fields and all. */
  text: string
  /** The headings above it, outermost first. */
  section: string[]
  /** The first line of the prose written under it before any list item: its
   *  description, as a row shows it under the words. Absent where there is none. */
  description?: string
  /** How many list items written directly under it are not tasks: its comments.
   *  Absent for none. */
  comments?: number
}

/** A file's size and times, milliseconds since the epoch. */
export interface Stamp {
  size: number
  mtime: number
  ctime: number
}

/** The two fields. */
export interface ScannedRows {
  /** The lines between the fences, or null for a note that opens with anything else. */
  front: string | null
  tasks: ScannedTask[]
}

/** How many task lines one note is read for; `MOST_TASKS` in links.rs. */
const MOST_TASKS = 5000

/** How much of a task line is kept, in characters; `LONGEST_TASK` in links.rs. */
export const LONGEST_TASK = 2000

/** How much of a description's first line is kept, in characters: more than any row
 *  has room for. `LONGEST_DESCRIPTION` in links.rs. */
export const LONGEST_DESCRIPTION = 300

/** A list item of any kind, a bullet or a number and then a blank or the end of the
 *  line: `is_list_item` in links.rs. */
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/

/** A list item the walk is inside of: a task, or an item that is not one. `told` is
 *  whether a list item has been written under it yet; a line of prose after that is
 *  no longer its description. */
interface Open {
  indent: number
  task: ScannedTask | null
  told: boolean
}

export function scanRows(content: string): ScannedRows {
  const block = frontMatterBlock(content)
  const front = block ? content.slice(block.body.from, block.body.to).replace(/\r?\n$/, '') : null
  // The block's own lines hold no task and no section.
  const wordsFrom = block ? lineOf(content, block.close) + 1 : 0

  const tasks: ScannedTask[] = []
  const section: { level: number; text: string }[] = []
  const open: Open[] = []
  const lines = content.split('\n')
  let fenced = false

  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? '').replace(/\r$/, '')
    const fence = isFence(line)
    if (fence) fenced = !fenced
    if (fenced || fence || index < wordsFrom) continue

    const heading = headingAt(line)
    if (heading) {
      while ((section.at(-1)?.level ?? 0) >= heading.level) section.pop()
      section.push(heading)
      // A heading ends every list above it.
      open.length = 0
      continue
    }

    const task = taskAt(line)
    const scanned =
      task && tasks.length < MOST_TASKS
        ? {
            line: index,
            indent: task.indent,
            mark: task.mark,
            text: clipped(line.slice(task.marker), LONGEST_TASK),
            section: section.map((one) => one.text),
          }
        : null
    if (scanned) tasks.push(scanned)
    under(open, line, task !== null, scanned)
  }

  return { front, tasks }
}

/** What a line says about the task it is written under, if any. A line belongs to the
 *  nearest list item indented less than it is, so a bullet under a comment is part of
 *  that comment, and a line indented no further than a task ends it; a blank line ends
 *  nothing. Under a task, a list item that is not a task is a comment, and the first
 *  line of prose before any list item is the description. */
function under(open: Open[], line: string, isTask: boolean, task: ScannedTask | null) {
  const words = line.trim()
  if (!words) return
  const indent = line.length - line.trimStart().length
  while ((open.at(-1)?.indent ?? -1) >= indent) open.pop()
  const owner = open.at(-1)

  if (isTask || LIST_ITEM.test(line)) {
    if (owner?.task) {
      owner.told = true
      if (!isTask) owner.task.comments = (owner.task.comments ?? 0) + 1
    }
    open.push({ indent, task, told: false })
  } else if (owner?.task && !owner.told && owner.task.description === undefined) {
    owner.task.description = clipped(words, LONGEST_DESCRIPTION)
  }
}

/** Which line an offset is on. */
function lineOf(content: string, at: number): number {
  let lines = 0
  for (
    let found = content.indexOf('\n');
    found !== -1 && found < at;
    found = content.indexOf('\n', found + 1)
  ) {
    lines++
  }
  return lines
}

/** Whether a line opens or closes a fenced code block: `is_fence` in links.rs. */
function isFence(line: string): boolean {
  const trimmed = line.trimStart()
  return (
    line.length - trimmed.length <= 3 && (trimmed.startsWith('```') || trimmed.startsWith('~~~'))
  )
}

/** A heading's level and words: `heading_of` in links.rs. */
function headingAt(line: string): { level: number; text: string } | null {
  const trimmed = line.trimStart()
  if (line.length - trimmed.length > 3) return null

  let level = 0
  while (trimmed[level] === '#') level++
  if (level === 0 || level > 6) return null

  const rest = trimmed.slice(level)
  if (!rest.startsWith(' ') && !rest.startsWith('\t')) return null

  return { level, text: rest.trim().replace(/#+$/, '').trim() }
}

/** At most `most` characters, cut on a character rather than a code unit. */
function clipped(text: string, most: number): string {
  if (text.length <= most) return text
  return Array.from(text).slice(0, most).join('')
}
