import { oneEdit, type TextEdit } from './edits'
import { frontMatterLines, isKeyLine, valueClosesAt } from './front-matter-lines'
import { flowItem, flowItems, listItem, scalar, uncommented, unquoted } from './yaml'

export { oneLine } from './yaml'
export { valueClosesAt }

export interface FrontMatterBlock {
  from: number
  to: number
  body: { from: number; to: number }
  close: number
}

interface KeyLine {
  from: number
  to: number
  value: { from: number; to: number }
}

const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#-].*?)[ \t]*:(?=\s|$)/

const NAME = /^(?![\s#\-?:,[\]{}&*!|>'"%@`])(?!.*:(?:\s|$))(?!.*\s#)[^\p{Cc}\p{Zl}\p{Zp}]+(?<!\s)$/u

export function isPropertyName(name: string): boolean {
  return NAME.test(name) && isKeyLine(`${name}: x`)
}

function keyWritten(key: string): string {
  return isKeyLine(`${key}: x`) ? key : JSON.stringify(key)
}

export function frontMatterBlock(source: string): FrontMatterBlock | null {
  const lines = frontMatterLines(source)
  if (!lines) return null

  const end = source.indexOf('\n', lines.close)
  return {
    from: lines.from,
    to: end === -1 ? source.length : end + 1,
    body: { from: lines.body, to: lines.close },
    close: lines.close,
  }
}

export function opensFrontMatter(source: string): boolean {
  return frontMatterLines(source) !== null
}

export type FrontMatterRow = readonly [
  key: string,
  value: string | number | boolean | readonly string[],
]

export function writeFrontMatter(rows: readonly FrontMatterRow[]): string {
  if (!rows.length) return ''

  const said = rows.map(([key, value]) => `${keyWritten(key)}: ${valueOf(value)}`)

  return `---\n${said.join('\n')}\n---`
}

function valueOf(value: FrontMatterRow[1]): string {
  if (typeof value === 'string') return scalar(value)
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : "''"
  return `[${value.map(flowItem).join(', ')}]`
}

export function frontMatter(source: string): string | null {
  const block = frontMatterBlock(source)
  if (!block) return null

  return source.slice(block.body.from, block.body.to).replace(/\r?\n$/, '')
}

export function stripFrontMatter(source: string): string {
  const block = frontMatterBlock(source)
  return block ? source.slice(block.to) : source
}

export function frontMatterList(source: string, key: string): string[] {
  const block = frontMatterBlock(source)
  if (!block) return []

  const line = keyLine(source, block, key)
  if (!line) return []

  const value = source.slice(line.value.from, line.value.to).trim()

  const closes = valueClosesAt(source, line.value.from, block.body.to)
  if (closes !== -1) {
    const joined = source
      .slice(line.value.from, closes)
      .split('\n')
      .map((one) => uncommented(one.trim()))
      .join(' ')
    return (flowItems(joined) ?? [unquoted(joined)]).filter(Boolean)
  }

  if (value) return (flowItems(value) ?? [unquoted(value)]).filter(Boolean)

  const out: string[] = []
  let at = line.to + 1

  while (at < block.body.to) {
    const end = source.indexOf('\n', at)
    const stop = end === -1 || end > block.body.to ? block.body.to : end
    const text = source.slice(at, stop)

    if (text.trim()) {
      const item = listItem(text)
      if (item === null) break
      out.push(item)
    }

    if (end === -1) break
    at = end + 1
  }

  return out.filter(Boolean)
}

export function frontMatterValue(source: string, key: string): string | null {
  const block = frontMatterBlock(source)
  if (!block) return null

  const line = keyLine(source, block, key)
  if (!line) return null

  const value = source.slice(line.value.from, line.value.to).trim()
  return unquoted(value) || null
}

export function frontMatterKeys(source: string): string[] {
  const block = frontMatterBlock(source)
  if (!block) return []

  return source
    .slice(block.body.from, block.body.to)
    .split('\n')
    .map((line) => KEY.exec(line.replace(/\r$/, ''))?.[1])
    .filter((key): key is string => key !== undefined)
    .map(unquoted)
}

function keyLine(source: string, block: FrontMatterBlock, key: string): KeyLine | null {
  const wanted = key.toLowerCase()
  let other: KeyLine | null = null
  let at = block.body.from

  while (at < block.body.to) {
    const end = source.indexOf('\n', at)
    const stop = end === -1 || end > block.body.to ? block.body.to : end
    const text = source.slice(at, stop)
    const found = KEY.exec(text)

    const name = found?.[1] === undefined ? undefined : unquoted(found[1])
    if (found && name?.toLowerCase() === wanted) {
      const value = at + found[0].length
      const to = value + uncommented(text.slice(found[0].length)).length
      const line = { from: at, to: stop, value: { from: value, to } }
      if (name === key) return line
      other ??= line
    }

    const closes = found ? valueClosesAt(source, at + found[0].length, block.body.to) : -1
    if (closes !== -1) {
      at = closes + 1
      continue
    }

    if (end === -1) break
    at = end + 1
  }

  return other
}

export function frontMatterEdits(
  source: string,
  keys: readonly (readonly [string, string | null])[],
): TextEdit | null {
  let after = source

  for (const [key, value] of keys) {
    const edit = frontMatterEdit(after, key, value)
    if (edit) after = after.slice(0, edit.from) + edit.insert + after.slice(edit.to)
  }

  return oneEdit(source, after)
}

export function frontMatterEdit(
  source: string,
  key: string,
  value: string | null,
): { from: number; to: number; insert: string } | null {
  const nl = source.includes('\r\n') ? '\r\n' : '\n'
  const block = frontMatterBlock(source)

  if (!block) {
    if (value === null) return null
    return { from: 0, to: 0, insert: `---${nl}${keyWritten(key)}: ${value}${nl}---${nl}` }
  }

  const found = keyLine(source, block, key)
  const line = found && withUnder(source, block, found)

  if (value === null) {
    if (!line) return null

    const rest =
      source.slice(block.body.from, line.from) + source.slice(cutTo(source, line), block.body.to)
    if (!rest.trim()) return { from: block.from, to: blankAfter(source, block.to), insert: '' }

    const to = cutTo(source, line)
    const left = frontMatterBlock(source.slice(0, line.from) + source.slice(to))
    if (left?.close !== block.close - (to - line.from)) {
      const end = source[line.value.to - 1] === '\r' ? line.value.to - 1 : line.value.to
      return source.slice(line.value.from, end).trim()
        ? { from: line.value.from, to: end, insert: '' }
        : null
    }

    return { from: line.from, to, insert: '' }
  }

  if (line) {
    const said = source.slice(line.value.from, line.value.to).trim()
    if (readAs(said) === readAs(value)) return null

    const to = source[line.value.to - 1] === '\r' ? line.value.to - 1 : line.value.to
    return { from: line.value.from, to, insert: ` ${value}` }
  }

  return { from: block.close, to: block.close, insert: `${keyWritten(key)}: ${value}${nl}` }
}

function readAs(value: string): string {
  const said = value.trim()
  const words = unquoted(said)
  return words !== said || scalar(said) === said ? `words ${words}` : `bare ${said}`
}

function withUnder(source: string, block: FrontMatterBlock, line: KeyLine): KeyLine {
  const closes = valueClosesAt(source, line.value.from, block.body.to)
  let to = closes === -1 ? line.to : closes
  let at = to
  while (at + 1 < block.body.to) {
    const stop = source.indexOf('\n', at + 1)
    const text = source.slice(at + 1, stop).trimEnd()
    if (text && !/^[ \t]/.test(text) && listItem(text) === null) break
    at = stop
    if (text) to = stop
  }
  return to === line.to ? line : { ...line, to, value: { ...line.value, to } }
}

function cutTo(source: string, line: KeyLine): number {
  return source.startsWith('\r\n', line.to) ? line.to + 2 : Math.min(line.to + 1, source.length)
}

function blankAfter(source: string, at: number): number {
  let over = at
  for (;;) {
    if (source.startsWith('\r\n', over)) over += 2
    else if (source.startsWith('\n', over)) over += 1
    else return over
  }
}
