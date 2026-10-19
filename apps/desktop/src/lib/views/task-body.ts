/** What is written under a task, read and written the way the task view edits it: its
 *  description, the prose straight under the line before any list item, and a new
 *  sub-task at the end of what it holds (docs/tasks.md 5.1).
 *
 *  The description is markdown in its own right, so it is handed out with the indent
 *  that makes it the task's own taken off, and given back to the note with that indent
 *  put on again: the list item's content column, the width of its marker. Pure; the
 *  task's line is found again by its anchor, as every other edit of a view finds it. */

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

  let end = at + 1
  let last = at
  while (end < lines.length) {
    const line = lines[end] ?? ''
    if (line.trim() === '') {
      end++
      continue
    }
    if (indentOf(line) <= own || LIST_ITEM.test(line)) break
    last = end
    end++
  }

  const from = at + 1
  const to = last + 1
  const said = lines
    .slice(from, to)
    .map((line) => dedent(line, indent))
    .join('\n')
  return { from, to: Math.max(from, to), text: said }
}

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
  const written = said
    ? said.split('\n').map((line) => (line.trim() === '' ? '' : indent + line) + ending)
    : []
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

/** The comments of the task an anchor names, in the order they are written. */
export function commentsOf(text: string, anchor: Anchor): Comment[] {
  const at = lineOfAnchor(text, anchor)
  if (at === null) return []
  const lines = text.split('\n').map((one) => one.replace(/\r$/, ''))
  const own = indentOf(lines[at] ?? '')
  const child = widthOf(contentIndent(lines[at] ?? ''))
  const out: Comment[] = []
  let open: Comment | null = null
  for (let next = at + 1; next < lines.length; next++) {
    const line = lines[next] ?? ''
    if (line.trim() === '') continue
    const depth = indentOf(line)
    if (depth <= own) break
    if (LIST_ITEM.test(line) && depth <= child) {
      open = null
      if (TASK_ITEM.test(line)) continue
      const words = line.replace(MARKER, '')
      const stamp = STAMP.exec(words)?.[1]
      open = { line: next, text: words.replace(STAMP, '').trim(), ...(stamp ? { at: stamp } : {}) }
      out.push(open)
    } else if (open && depth > child) {
      open.text = `${open.text}\n${line.trim()}`
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
    `${indent}- ${first.trim()} [at:: ${stamp}]${ending}`,
    ...rest.filter((one) => one.trim()).map((one) => `${indent}  ${one.trim()}${ending}`),
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
