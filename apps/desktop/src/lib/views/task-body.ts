/** What is written under a task, read and written the way the task view edits it: its
 *  description, the prose straight under the line before any list item, and a new
 *  sub-task at the end of what it holds (docs/tasks.md 5.1).
 *
 *  The description is markdown in its own right, so it is handed out with the indent
 *  that makes it the task's own taken off, and given back to the note with that indent
 *  put on again: the list item's content column, the width of its marker. Pure; the
 *  task's line is found again by its anchor, as every other edit of a view finds it. */

import type { Row, TaskChange } from '@nib/bases'
import { CODE, type CodeLine, CodeBlocks, OPENS, WORDS } from '@nib/markdown/fences'
import { changed } from '../rows/write'
import { lineOfAnchor } from './lines'

interface Anchor {
  line: number
  hash: string
}

/** A task's description, as the lines of the note it spans and the words it says. */
export interface Description {
  /** The first line it is on and the line after its last, counting from zero; equal
   *  where there is none, at the line it would start on. */
  from: number
  to: number
  /** The words, the task's indent taken off each line. */
  text: string
}

const MARKER = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)/
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/

const widthOf = (prefix: string) => prefix.replace(/\t/g, '    ').length

/** The indent a line under the task must have to be the task's own: as far in as its
 *  marker reaches, the leading tabs it was written with kept. */
function contentIndent(line: string): string {
  const found = MARKER.exec(line)
  if (!found) return '  '
  const [, lead = '', marker = '', gap = ''] = found
  return lead + ' '.repeat(marker.length + Math.min(gap.length, 4))
}

/** A line's own indent, as columns. */
const indentOf = (line: string) => widthOf(/^[ \t]*/.exec(line)?.[0] ?? '')

/** The description of the task an anchor names, or null where the note has no such task. */
export function descriptionOf(text: string, anchor: Anchor): Description | null {
  const at = lineOfAnchor(text, anchor)
  if (at === null) return null
  const lines = text.split('\n').map((one) => one.replace(/\r$/, ''))
  const own = indentOf(lines[at] ?? '')
  const indent = widthOf(contentIndent(lines[at] ?? ''))
  // The lines the task holds, before the first indented no further than it.
  const held = lines.slice(at + 1)
  const out = held.findIndex((line) => line.trim() !== '' && indentOf(line) <= own)
  const kinds = kindsOf(lines[at] ?? '', out === -1 ? held : held.slice(0, out))

  let end = at + 1
  let last = at
  while (end < lines.length) {
    const line = lines[end] ?? ''
    if (line.trim() === '') {
      end++
      continue
    }
    // A list item that opens a fence of its own is still a list item.
    if (indentOf(line) <= own || (LIST_ITEM.test(line) && kinds[end - at - 1] !== CODE)) break
    last = end
    end++
  }

  const from = at + 1
  const to = last + 1
  const said = lines
    .slice(from, to)
    .map((line, index) =>
      kinds[index] === WORDS ? unescaped(dedent(line, indent)) : dedent(line, indent),
    )
    .join('\n')
  return { from, to: Math.max(from, to), text: said }
}

/** What each of these lines, written under the task line `task`, is to scan.ts and
 *  the page (`CodeBlocks`): words, code, or a fence that opens code. Code is a fenced
 *  block, and code indented four columns past the task's content after a blank line.
 *  In it a list mark is code, so it is written as typed and ends nothing; a backslash
 *  there would be a character of the code.
 *
 *  Read from the task line down with the task's own indent taken off, so the task is
 *  the list item these lines are inside of, wherever it is nested. */
function kindsOf(task: string, lines: readonly string[]): CodeLine[] {
  const own = indentOf(task)
  const code = new CodeBlocks()
  code.line(dedent(task, own))
  return lines.map((line) => code.line(dedent(line, own)))
}

/** Whether the fence `code` has just been handed is closed among these lines, each
 *  read as it is written: under the task's content column, a blank line empty. */
function closedIn(code: CodeBlocks, rest: readonly string[], indent: string, own: number): boolean {
  const ahead = code.copy()
  for (const line of rest) {
    ahead.line(line.trim() === '' ? '' : dedent(indent + line, own))
    if (ahead.fence === null) return true
  }
  return false
}

/** A bullet or a number at the start of a line, and the backslashes already before its
 *  mark: `- a`, `\\- a`, `1. a`, `1\\. a`. */
const BULLET = /^([ \t]*)(\\*)([-*+](?:[ \t]|$))/
const NUMBER = /^([ \t]*\d{1,9})(\\*)([.)](?:[ \t]|$))/
/** A fence's delimiter, and the backslashes already before it. */
const FENCE = /^([ \t]*)(\\*)(```|~~~)/

/** A description's line as the note writes it: one that would start a list item gets a
 *  backslash before its mark, which is the same words to markdown. The description ends
 *  at the first list item, so `- a` written bare would be a list item of the task (or,
 *  as `- [ ] x`, a sub-task), outside the lines the next write replaces, and every save
 *  of the task view wrote it again. A line that had a backslash there already gets one
 *  more, so reading takes exactly one off and every description reads back as typed.
 *  Outside a code block a fence is one left open (see `withDescription`), which would hide every
 *  later line of the note from the index; it is written `\\```` the same way. */
function escaped(line: string): string {
  return line.replace(BULLET, '$1\\$2$3').replace(NUMBER, '$1\\$2$3').replace(FENCE, '$1\\$2$3')
}

/** A description's line as it was typed: `escaped` undone. */
function unescaped(line: string): string {
  return line
    .replace(ESCAPED_BULLET, '$1$2')
    .replace(ESCAPED_NUMBER, '$1$2')
    .replace(ESCAPED_FENCE, '$1$2')
}

/** The same with a backslash before the mark, the first of which `unescaped` takes off. */
const ESCAPED_BULLET = /^([ \t]*)\\(\\*[-*+](?:[ \t]|$))/
const ESCAPED_NUMBER = /^([ \t]*\d{1,9})\\(\\*[.)](?:[ \t]|$))/
const ESCAPED_FENCE = /^([ \t]*)\\(\\*(?:```|~~~))/

/** A line with up to `columns` of its indent taken off. */
function dedent(line: string, columns: number): string {
  let at = 0
  let width = 0
  while (at < line.length && width < columns) {
    const one = line[at]
    if (one === ' ') width++
    else if (one === '\t') width += 4
    else break
    at++
  }
  return line.slice(at)
}

/** The note with the task's description replaced by these words, indented to be the
 *  task's own; an empty description takes the lines away. Null where the note has no
 *  such task, or the words are what it says already. */
export function withDescription(text: string, anchor: Anchor, words: string): string | null {
  const now = descriptionOf(text, anchor)
  if (!now) return null
  const said = words.replace(/\s+$/, '')
  if (said === now.text.replace(/\s+$/, '')) return null

  const lines = text.split('\n')
  const at = now.from - 1
  const indent = contentIndent((lines[at] ?? '').replace(/\r$/, ''))
  const ending = (lines[at] ?? '').endsWith('\r') ? '\r' : ''
  const typed = said ? said.split('\n') : []
  // Whether a line is code is judged as the note will hold it, at the task's indent,
  // each line after the ones above it as they are written. A fence is kept as typed
  // where it opens a block that closes among these lines: one left open is no code
  // block yet, and would hide every later line of the note from the index. A list
  // item is escaped even where it opens a fence, as it would end the description.
  const task = (lines[at] ?? '').replace(/\r$/, '')
  const own = indentOf(task)
  const code = new CodeBlocks()
  code.line(dedent(task, own))
  const written = typed.map((line, index) => {
    if (line.trim() === '') {
      code.line('')
      return ending
    }
    const trial = code.copy()
    const kind = trial.line(dedent(indent + line, own))
    const kept =
      kind === CODE ||
      (kind === OPENS &&
        !LIST_ITEM.test(line) &&
        closedIn(trial, typed.slice(index + 1), indent, own))
    const out = indent + (kept ? line : escaped(line))
    code.line(dedent(out, own))
    return out + ending
  })
  lines.splice(now.from, now.to - now.from, ...written)
  return lines.join('\n')
}

/** The note with a sub-task added at the end of what the task holds: under its
 *  description, its sub-tasks and its comments, at its content column. */
export function withSubtask(text: string, anchor: Anchor, line: string): string | null {
  const at = lineOfAnchor(text, anchor)
  if (at === null || !line.trim()) return null
  const lines = text.split('\n')
  const task = (lines[at] ?? '').replace(/\r$/, '')
  const own = indentOf(task)
  let last = at
  for (let next = at + 1; next < lines.length; next++) {
    const one = lines[next] ?? ''
    if (one.trim() === '') continue
    if (indentOf(one) <= own) break
    last = next
  }
  const ending = (lines[at] ?? '').endsWith('\r') ? '\r' : ''
  lines.splice(last + 1, 0, `${contentIndent(task)}${line.trim()}${ending}`)
  return lines.join('\n')
}

/** One of a task's comments: a list item straight under it that is no task, Todoist's
 *  comment the nib way, with the moment it was written where the composer stamped one
 *  (`[at:: …]`). */
export interface Comment {
  /** Its line in the note, counting from zero. */
  line: number
  /** Its words, the stamp taken off and its own further lines joined on. */
  text: string
  /** When it was written, `YYYY-MM-DDTHH:mm`, where it says. */
  at?: string
}

const TASK_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[.\]/
const STAMP = /[ \t]*\[at::[ \t]*([^\]]*?)[ \t]*\]/
/** A box at the start of a comment's words, and the backslashes before it: a comment
 *  that opens `[ ] ` is written `\\[ ] `, or its line would be a sub-task. One more
 *  backslash than it was typed with, as a description's list marks (`escaped`). */
const BOXED = /^(\\+)(\[.\])/
const BOX = /^(\\*)(\[.\])/
/** The same after a list mark, on a comment's further lines: `- [ ] x` there is written
 *  `- \\[ ] x`, or it would be a task under the comment's task, which the comment's
 *  words held as well and whose cross deleted it. */
const LISTED_BOX = /^((?:[-*+]|\d{1,9}[.)])[ \t]+)(\\*)(\[.\])/
const LISTED_BOXED = /^((?:[-*+]|\d{1,9}[.)])[ \t]+)\\(\\*\[.\])/

/** The comments of the task an anchor names, in the order they are written. */
export function commentsOf(text: string, anchor: Anchor): Comment[] {
  const at = lineOfAnchor(text, anchor)
  if (at === null) return []
  const lines = text.split('\n').map((one) => one.replace(/\r$/, ''))
  const own = indentOf(lines[at] ?? '')
  const child = widthOf(contentIndent(lines[at] ?? ''))
  const out: Comment[] = []
  let open: Comment | null = null
  // A code block in the description may hold list items; they are none of its comments.
  const from = descriptionOf(text, anchor)?.to ?? at + 1
  for (let next = from; next < lines.length; next++) {
    const line = lines[next] ?? ''
    if (line.trim() === '') continue
    const depth = indentOf(line)
    if (depth <= own) break
    if (LIST_ITEM.test(line) && depth <= child) {
      open = null
      if (TASK_ITEM.test(line)) continue
      const words = line
        .replace(MARKER, '')
        .replace(BOXED, (_, slashes: string, box: string) => slashes.slice(1) + box)
      const stamp = STAMP.exec(words)?.[1]
      open = { line: next, text: words.replace(STAMP, '').trim(), ...(stamp ? { at: stamp } : {}) }
      out.push(open)
    } else if (open && depth > child) {
      open.text = `${open.text}\n${line.trim().replace(LISTED_BOXED, '$1$2')}`
    } else open = null
  }
  return out
}

/** The note with a comment added under the task, after the last one it has (or at the
 *  end of what it holds), stamped with when it was written. Lines after its first go
 *  under it, so it stays one comment. */
export function withComment(
  text: string,
  anchor: Anchor,
  words: string,
  stamp: string,
): string | null {
  const said = words.trim()
  const at = lineOfAnchor(text, anchor)
  if (at === null || !said) return null
  const lines = text.split('\n')
  const task = (lines[at] ?? '').replace(/\r$/, '')
  const indent = contentIndent(task)
  const ending = (lines[at] ?? '').endsWith('\r') ? '\r' : ''
  const own = indentOf(task)
  let last = at
  for (let next = at + 1; next < lines.length; next++) {
    const one = lines[next] ?? ''
    if (one.trim() === '') continue
    if (indentOf(one) <= own) break
    last = next
  }
  const [first = '', ...rest] = said.split('\n')
  const written = [
    `${indent}- ${first.trim().replace(BOX, '\\$1$2')} [at:: ${stamp}]${ending}`,
    ...rest
      .filter((one) => one.trim())
      .map((one) => `${indent}  ${one.trim().replace(LISTED_BOX, '$1\\$2$3')}${ending}`),
  ]
  lines.splice(last + 1, 0, ...written)
  return lines.join('\n')
}

/** The note without the comment on a line of it, its further lines with it. */
export function withoutComment(text: string, anchor: Anchor, line: number): string | null {
  const found = commentsOf(text, anchor).find((one) => one.line === line)
  if (!found) return null
  const lines = text.split('\n')
  const own = indentOf(lines[line] ?? '')
  let end = line + 1
  while (end < lines.length && (lines[end] ?? '').trim() !== '' && indentOf(lines[end] ?? '') > own)
    end++
  lines.splice(line, end - line)
  return lines.join('\n')
}

/** The note with a task changed the way the field that edits it says: its line and,
 *  where the field held a description, the words under it. Both are found by the
 *  row's anchor while the line still says what the anchor hashed: the description is
 *  written first, which leaves the line as it was, and the line after. The words a
 *  change writes need not read back as typed (a label taken off from among them, a
 *  trailing tag, an inline field), so the line is never looked for by them. Null, and
 *  so nothing written, where the note no longer has the task: neither part is
 *  written without the other. */
export function editedTask(
  text: string,
  row: Row,
  change: TaskChange,
  description: string | null,
): string | null {
  const anchor = row.anchor
  if (!anchor || !row.task || lineOfAnchor(text, anchor) === null) return null
  const described =
    description === null ? text : (withDescription(text, anchor, description) ?? text)
  return changed(described, row, { task: change })
}
