import type { Row, TaskChange } from '@orden/bases'
import { CODE, type CodeLine, CodeBlocks, OPENS, WORDS } from '@orden/markdown/fences'
import { changedTask } from '@orden/markdown/task-edits'
import { readTask } from '@orden/markdown/task-line'
import { changed } from '../rows/write'
import { lineOfAnchor } from './lines'

interface Anchor {
  line: number
  hash: string
}

export interface Description {
  from: number
  to: number
  text: string
}

const MARKER = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)/
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/

const widthOf = (prefix: string) => prefix.replace(/\t/g, '    ').length

function contentIndent(line: string): string {
  const found = MARKER.exec(line)
  if (!found) return '  '
  const [, lead = '', marker = '', gap = ''] = found
  return lead + ' '.repeat(marker.length + Math.min(gap.length, 4))
}

const indentOf = (line: string) => widthOf(/^[ \t]*/.exec(line)?.[0] ?? '')

export function descriptionOf(text: string, anchor: Anchor): Description | null {
  const at = lineOfAnchor(text, anchor)
  if (at === null) return null
  const lines = text.split('\n').map((one) => one.replace(/\r$/, ''))
  const own = indentOf(lines[at] ?? '')
  const indent = widthOf(contentIndent(lines[at] ?? ''))
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
    if (indentOf(line) <= own || (LIST_ITEM.test(line) && !kinds[end - at - 1]?.held)) break
    last = end
    end++
  }

  const from = at + 1
  const to = last + 1
  const said = lines
    .slice(from, to)
    .map((line, index) =>
      kinds[index]?.kind === WORDS ? unescaped(dedent(line, indent)) : dedent(line, indent),
    )
    .join('\n')
  return { from, to: Math.max(from, to), text: said }
}

function kindsOf(task: string, lines: readonly string[]): { kind: CodeLine; held: boolean }[] {
  const own = indentOf(task)
  const code = new CodeBlocks()
  code.line(dedent(task, own))
  return lines.map((line) => {
    const kind = code.line(dedent(line, own))
    return { kind, held: kind === CODE && !code.openedItem }
  })
}

function closedIn(code: CodeBlocks, rest: readonly string[], indent: string, own: number): boolean {
  const ahead = code.copy()
  for (const line of rest) {
    ahead.line(line.trim() === '' ? '' : dedent(indent + line, own))
    if (ahead.fence === null) return true
  }
  return false
}

const BULLET = /^([ \t]*)(\\*)([-*+](?:[ \t]|$))/
const NUMBER = /^([ \t]*\d{1,9})(\\*)([.)](?:[ \t]|$))/
const FENCE = /^([ \t]*)(\\*)(```|~~~)/

function escaped(line: string): string {
  return line.replace(BULLET, '$1\\$2$3').replace(NUMBER, '$1\\$2$3').replace(FENCE, '$1\\$2$3')
}

function unescaped(line: string): string {
  return line
    .replace(ESCAPED_BULLET, '$1$2')
    .replace(ESCAPED_NUMBER, '$1$2')
    .replace(ESCAPED_FENCE, '$1$2')
}

const ESCAPED_BULLET = /^([ \t]*)\\(\\*[-*+](?:[ \t]|$))/
const ESCAPED_NUMBER = /^([ \t]*\d{1,9})\\(\\*[.)](?:[ \t]|$))/
const ESCAPED_FENCE = /^([ \t]*)\\(\\*(?:```|~~~))/

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
      (kind === CODE && !trial.openedItem) ||
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

export interface Comment {
  line: number
  text: string
  at?: string
}

const TASK_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[.\]/
const STAMP = /[ \t]*\[at::[ \t]*([^\]]*?)[ \t]*\]/
const BOXED = /^(\\+)(\[.\])/
const BOX = /^(\\*)(\[.\])/
const LISTED_BOX = /^((?:[-*+]|\d{1,9}[.)])[ \t]+)(\\*)(\[.\])/
const LISTED_BOXED = /^((?:[-*+]|\d{1,9}[.)])[ \t]+)\\(\\*\[.\])/

export function commentsOf(text: string, anchor: Anchor): Comment[] {
  const at = lineOfAnchor(text, anchor)
  if (at === null) return []
  const lines = text.split('\n').map((one) => one.replace(/\r$/, ''))
  const own = indentOf(lines[at] ?? '')
  const child = widthOf(contentIndent(lines[at] ?? ''))
  const out: Comment[] = []
  let open: Comment | null = null
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

export const NEEDS_INPUT = 'needs-input'

export function withoutNeedsInput(text: string, anchor: Anchor): string {
  const at = lineOfAnchor(text, anchor)
  if (at === null) return text
  const lines = text.split('\n')
  const line = lines[at] ?? ''
  const fields = readTask(line.replace(/\r$/, ''))
  if (!fields?.tags.includes(NEEDS_INPUT)) return text
  lines[at] = changedTask(line, { tags: fields.tags.filter((one) => one !== NEEDS_INPUT) })
  return lines.join('\n')
}

export function askedFor(
  text: string,
  anchor: Anchor,
  words: string,
  stamp: string,
): string | null {
  const at = lineOfAnchor(text, anchor)
  if (at === null) return null
  const fields = readTask((text.split('\n')[at] ?? '').replace(/\r$/, ''))
  if (!fields || fields.done || fields.cancelled || fields.tags.includes(NEEDS_INPUT)) return null
  const commented = withComment(text, anchor, words, stamp) ?? text
  const lines = commented.split('\n')
  lines[at] = changedTask(lines[at] ?? '', { tags: [...fields.tags, NEEDS_INPUT] })
  return lines.join('\n')
}

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
