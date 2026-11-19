import { frontMatterBlock } from '@orden/markdown/front-matter'
import { blockIdOf, blockSpan, blockSpanAt, headingRows, lines, slugify } from '@orden/markdown/links'
import { taskAt } from '@orden/markdown/tasks'
import { isRecord } from '../../platform/src/api'
import { DocError } from './problem'

export type Anchor =
  | { quote: string; prefix?: string; suffix?: string }
  | { heading: string; nth?: number }
  | { block: string }
  | { task: string; nth?: number }
  | { selection: true }
  | { start: true }
  | { end: true }

type Shape = 'words' | 'line' | 'item' | 'paragraph' | 'edge'

export interface Place {
  from: number
  to: number
  shape: Shape
  keep?: string
  indent?: string
  after?: number
}

export function oneEnding(words: string): string {
  return words.replace(/\r\n?/g, '\n')
}

function described(anchor: Anchor): string {
  if ('quote' in anchor) return `the quote "${clipped(anchor.quote)}"`
  if ('heading' in anchor) return `the heading ${anchor.heading}`
  if ('block' in anchor) return `the block ^${anchor.block}`
  if ('task' in anchor) return `the task "${clipped(anchor.task)}"`
  if ('selection' in anchor) return 'the selection'
  return 'start' in anchor ? 'the start' : 'the end'
}

function clipped(words: string): string {
  return words.length > 60 ? `${words.slice(0, 57)}...` : words
}

function optionalWords(value: unknown): string | undefined {
  return typeof value === 'string' && value ? oneEnding(value) : undefined
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined
}

export function readAnchor(value: unknown): Anchor {
  if (!isRecord(value)) throw new DocError('bad_anchor', value, 'an anchor is an object')

  const { quote, heading, block, task } = value
  const nth = optionalCount(value.nth)

  if (typeof quote === 'string') {
    if (!quote) throw new DocError('bad_anchor', value, 'a quote needs words')
    const prefix = optionalWords(value.prefix)
    const suffix = optionalWords(value.suffix)
    return {
      quote: oneEnding(quote),
      ...(prefix === undefined ? {} : { prefix }),
      ...(suffix === undefined ? {} : { suffix }),
    }
  }

  if (typeof heading === 'string' && heading.trim()) {
    return { heading, ...(nth === undefined ? {} : { nth }) }
  }
  if (typeof block === 'string' && block.trim()) return { block: block.trim().replace(/^\^/, '') }
  if (typeof task === 'string' && task.trim()) {
    return { task: oneEnding(task), ...(nth === undefined ? {} : { nth }) }
  }
  if (value.selection === true) return { selection: true }
  if (value.start === true) return { start: true }
  if (value.end === true) return { end: true }

  throw new DocError('bad_anchor', value, 'an anchor is one of quote, heading, block, task, selection, start and end')
}

export interface Selected {
  from: number
  to: number
}

export function resolve(anchor: Anchor, text: string, selected: Selected | null = null): Place {
  if ('quote' in anchor) return quoted(anchor, text)
  if ('heading' in anchor) return section(anchor, text)
  if ('block' in anchor) return blockNamed(anchor, text)
  if ('task' in anchor) return taskNamed(anchor, text)

  if ('selection' in anchor) {
    if (!selected) {
      throw new DocError('no_selection', anchor, 'the note is not in front of the reader')
    }
    return { from: selected.from, to: selected.to, shape: 'words' }
  }

  if ('start' in anchor) {
    const at = frontMatterBlock(text)?.to ?? 0
    return { from: at, to: at, shape: 'edge' }
  }

  return { from: text.length, to: text.length, shape: 'edge' }
}

function one<T>(found: readonly T[], anchor: Anchor, nth: number | undefined): T {
  if (nth !== undefined) {
    const picked = found[nth - 1]
    if (picked !== undefined) return picked

    throw new DocError(
      'not_found',
      anchor,
      `${described(anchor)} is in the note ${String(found.length)} times, not ${String(nth)}`,
      found.length,
    )
  }

  const [only] = found
  if (only === undefined) {
    throw new DocError('not_found', anchor, `${described(anchor)} is not in the note`)
  }
  if (found.length > 1) {
    throw new DocError(
      'ambiguous',
      anchor,
      `${described(anchor)} is in the note ${String(found.length)} times`,
      found.length,
    )
  }
  return only
}

function quoted(anchor: Extract<Anchor, { quote: string }>, text: string): Place {
  const { quote, prefix = '', suffix = '' } = anchor
  const found: number[] = []

  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    if (prefix && !text.endsWith(prefix, at)) continue
    if (suffix && !text.startsWith(suffix, at + quote.length)) continue
    found.push(at)
  }

  const at = one(found, anchor, undefined)
  return { from: at, to: at + quote.length, shape: 'words' }
}

export interface HeadingAt {
  level: number
  title: string
  path: readonly string[]
  line: number
  from: number
  to: number
}

export function headingsIn(text: string): HeadingAt[] {
  const found: HeadingAt[] = []
  const open: HeadingAt[] = []
  let words = 0

  const close = (level: number) => {
    while (open.length && (open.at(-1)?.level ?? 0) >= level) {
      const done = open.pop()
      if (done) done.to = words
    }
  }

  const starts = new Map(headingRows(text).map((one) => [one.line, one]))
  for (const row of lines(text)) {
    const start = starts.get(row.line)
    if (start) {
      close(start.level)
      const heading: HeadingAt = {
        level: start.level,
        title: start.text,
        path: open.map((one) => one.title),
        line: row.line,
        from: row.from,
        to: row.from + row.text.length,
      }
      found.push(heading)
      open.push(heading)
    }

    if (row.text.trim()) words = row.from + row.text.length
  }

  close(0)
  return found
}

export function headingPath(heading: Pick<HeadingAt, 'path' | 'title'>): string {
  return [...heading.path, heading.title].map((one) => one.replaceAll('/', '\\/')).join('/')
}

function steps(path: string): string[] {
  return path.split(/(?<!\\)\//).map((one) => one.replaceAll('\\/', '/').trim())
}

function names(step: string, title: string): boolean {
  return title.toLowerCase() === step.toLowerCase() || slugify(title) === slugify(step)
}

function under(heading: HeadingAt, wanted: readonly string[]): boolean {
  const last = wanted.at(-1)
  if (last === undefined || !names(last, heading.title)) return false

  let at = 0
  for (const step of wanted.slice(0, -1)) {
    while (at < heading.path.length && !names(step, heading.path[at] ?? '')) at++
    if (at === heading.path.length) return false
    at++
  }
  return true
}

function headingsNamed(headings: readonly HeadingAt[], named: string): HeadingAt[] {
  const wanted = steps(named)
  const whole = named.trim()
  return headings.filter((heading) => under(heading, wanted) || (wanted.length > 1 && names(whole, heading.title)))
}

export function headingAnchor(headings: readonly HeadingAt[], heading: HeadingAt): { heading: string; nth?: number } {
  const path = headingPath(heading)
  const found = headingsNamed(headings, path)
  const nth = found.indexOf(heading) + 1
  return found.length > 1 && nth > 0 ? { heading: path, nth } : { heading: path }
}

function section(anchor: Extract<Anchor, { heading: string }>, text: string): Place {
  const found = headingsNamed(headingsIn(text), anchor.heading)

  const heading = one(found, anchor, anchor.nth)
  return { from: heading.from, to: heading.to, shape: 'paragraph' }
}

function blockNamed(anchor: Extract<Anchor, { block: string }>, text: string): Place {
  const rows = [...lines(text)]
  const marked = rows.filter((row) => !row.matter && (row.code ? row.fenceName : blockIdOf(row.text)) === anchor.block)
  const row = one(marked, anchor, undefined)

  const alone = row.text.trim() === `^${anchor.block}`
  const span = blockSpan(rows, row.line)
  const start = rows[span.first] ?? row
  const end = alone ? row : (rows[span.last] ?? row)
  const apart = alone && row.line > 0 && !rows[row.line - 1]?.text.trim()
  const indent = leadOf(start.text)
  const keep = alone ? `${apart ? '\n\n' : '\n'}${leadOf(row.text)}^${anchor.block}` : ` ^${anchor.block}`
  return {
    from: start.from,
    to: end.from + end.text.length,
    shape: ITEM.test(start.text) && !(alone && apart) ? 'item' : 'paragraph',
    keep,
    ...(indent ? { indent } : {}),
  }
}

const ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/

function leadOf(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? ''
}

export function taskWords(line: string): string | null {
  const task = taskAt(line)
  if (!task) return null

  const words = line.slice(task.marker)
  const id = blockIdOf(words)
  return (id ? words.slice(0, words.lastIndexOf(`^${id}`)) : words).trim()
}

function taskNamed(anchor: Extract<Anchor, { task: string }>, text: string): Place {
  const wanted = (taskWords(anchor.task) ?? anchor.task).trim()
  const rows = [...lines(text)]
  const found = rows.filter((row) => !row.code && taskWords(row.text) === wanted)

  const row = one(found, anchor, anchor.nth)
  const id = blockIdOf(row.text)
  const indent = leadOf(row.text)
  const end = rows[blockSpanAt(text, row.line).end] ?? row
  return {
    from: row.from,
    to: row.from + row.text.length,
    shape: 'item',
    after: Math.max(row.from + row.text.length, end.from + end.text.length),
    ...(id ? { keep: ` ^${id}` } : {}),
    ...(indent ? { indent } : {}),
  }
}

export function taskIn<T extends { anchor: Anchor }>(rows: readonly T[], value: unknown): T {
  const anchor = readAnchor(value)
  if (!('task' in anchor)) throw new DocError('bad_anchor', value, 'at is {task, nth?}')

  const wanted = (taskWords(anchor.task) ?? anchor.task).trim()
  const found = rows.filter((row) => 'task' in row.anchor && row.anchor.task === wanted)
  return one(found, anchor, anchor.nth)
}
