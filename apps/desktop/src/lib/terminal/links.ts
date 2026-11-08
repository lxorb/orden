import type { IBuffer, IBufferCell, ILink, ILinkProvider, Terminal } from '@xterm/xterm'

const URL =
  /https?:\/\/[^\s"'!*(){}|\\^<>`\u2500-\u257f]*[^\s"':,.!?{}|\\^~[\]`()<>\u2500-\u257f]/gi
const PART = /[^\s"'!*(){}|\\^<>`\u2500-\u257f]/
const LEADING = /^[^\s"'!*(){}|\\^<>`\u2500-\u257f]+/
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
const FURTHEST = 64

export interface Cell {
  x: number
  y: number
}

export interface Found {
  text: string
  start: Cell
  end: Cell
}

interface Row {
  text: string
  at: Cell[]
  wide: boolean[]
}

function rowOf(buffer: IBuffer, y: number, cols: number, cell: IBufferCell): Row | null {
  const line = buffer.getLine(y)
  if (!line) return null
  let text = ''
  const at: Cell[] = []
  const wide: boolean[] = []
  for (let x = 0; x < Math.min(cols, line.length); x++) {
    line.getCell(x, cell)
    const width = cell.getWidth()
    if (width === 0) continue
    const chars = cell.getChars() || ' '
    for (const unit of chars.split('')) {
      at.push({ x, y })
      wide.push(width > 1)
      text += unit
    }
  }
  return { text, at, wide }
}

function trimmed(row: Row): Row {
  return cut(row, 0, row.text.replace(/ +$/, '').length)
}

function cut(row: Row, from: number, to = row.text.length): Row {
  return {
    text: row.text.slice(from, to),
    at: row.at.slice(from, to),
    wide: row.wide.slice(from, to),
  }
}

const LEFT = /^[ \u2500-\u257f]*/
const RIGHT = /[ \u2500-\u257f]*$/

interface Framed {
  left: number
  right: number
  start: number
  border: string
  content: string
}

function framed(row: Row): Framed {
  const left = LEFT.exec(row.text)?.[0].length ?? 0
  const right = left === row.text.length ? 0 : (RIGHT.exec(row.text)?.[0].length ?? 0)
  const content = row.text.slice(left, row.text.length - right)
  const border = row.text.slice(0, left).trimStart()
  return { left, right, start: row.at[left]?.x ?? -1, border, content }
}

function fills(row: Row, frame: Framed): boolean {
  const edge = row.text.slice(row.text.length - frame.right)
  const closing = frame.border.split('').reverse().join('')
  if (!closing) return edge === ''
  return edge.replace(/ +$/, '') === closing
}

function looksContinued(before: Row, next: Row, column: number | null): boolean {
  const above = framed(before)
  const below = framed(next)
  if (!PART.test(above.content.at(-1) ?? ' ') || !fills(before, above)) return false
  const leading = LEADING.exec(below.content)?.[0]
  if (!leading || leading !== below.content || SCHEME.test(leading)) return false
  if (below.border !== above.border) return false
  if (above.border && next.text.trimEnd().length !== before.text.trimEnd().length) return false
  return column === null || below.start === above.start || below.start === column
}

function inAddress(text: string): boolean {
  const run = /\S*$/.exec(text)?.[0] ?? ''
  return run.includes('://')
}

function addressColumn(line: Row): number | null {
  const run = /\S*$/.exec(line.text)?.[0] ?? ''
  return line.at[line.text.length - run.length]?.x ?? null
}

function lineAround(buffer: IBuffer, cols: number, y: number) {
  const cell = buffer.getNullCell()
  const rows = new Map<number, Row | null>()
  const row = (at: number) => {
    if (!rows.has(at)) rows.set(at, rowOf(buffer, at, cols, cell))
    return rows.get(at) ?? null
  }
  const joins = (above: number, below: number) => {
    const a = row(above)
    const b = row(below)
    if (!a || !b) return false
    return buffer.getLine(below)?.isWrapped === true || looksContinued(a, b, null)
  }

  let top = y
  while (top > 0 && y - top < FURTHEST && joins(top - 1, top)) top--

  let last = row(top)
  if (!last) return null
  let line = last
  let broken = false
  for (let next = top + 1; next - top < 2 * FURTHEST; next++) {
    const below = row(next)
    if (!below) break
    const soft = buffer.getLine(next)?.isWrapped === true
    const kept = soft ? trimmed(line) : cut(line, 0, line.text.length - framed(last).right)
    const hard = !soft && inAddress(kept.text) && looksContinued(last, below, addressColumn(kept))
    if (!soft && !hard) {
      if (next > y) break
      line = below
      last = below
      broken = false
      continue
    }
    const added = hard ? cut(below, framed(below).left) : below
    line = {
      text: kept.text + added.text,
      at: [...kept.at, ...added.at],
      wide: [...kept.wide, ...added.wide],
    }
    last = below
    broken ||= hard
  }
  return { ...trimmed(line), broken }
}

export function linksOn(buffer: IBuffer, cols: number, y: number): Found[] {
  const line = lineAround(buffer, cols, y)
  if (!line) return []
  const found: Found[] = []
  for (const match of line.text.matchAll(URL)) {
    const text = match[0]
    if (!isAddress(text)) continue
    const from = match.index
    const to = from + text.length - 1
    const start = line.at[from]
    const last = line.at[to]
    if (!start || !last) continue
    const end = { x: last.x + (line.wide[to] ? 1 : 0), y: last.y }
    if (start.y <= y && end.y >= y) found.push({ text, start, end })
  }
  return found
}

function isAddress(text: string): boolean {
  try {
    const url = new globalThis.URL(text)
    return text.toLowerCase().startsWith(`${url.protocol}//`)
  } catch {
    return false
  }
}

export function unbroken(buffer: IBuffer, cols: number, start: Cell, end: Cell): string | null {
  if (end.y <= start.y) return null
  const line = lineAround(buffer, cols, start.y)
  if (!line?.broken) return null
  const before = (a: Cell, b: Cell) => a.y < b.y || (a.y === b.y && a.x < b.x)
  const lastRow = line.at.at(-1)?.y ?? -1
  if (end.y > lastRow + 1 || (end.y === lastRow + 1 && end.x > 0)) return null
  const chosen = line.at
    .map((cell, i) => (!before(cell, start) && before(cell, end) ? line.text[i] : ''))
    .join('')
  const text = chosen.trim()
  if (!text || /\s/.test(text)) return null
  for (const match of line.text.matchAll(URL)) {
    if (isAddress(match[0]) && match[0].includes(text)) return text
  }
  return null
}

export class AddressLinks implements ILinkProvider {
  constructor(
    private readonly term: Terminal,
    private readonly pointed: (uri: string | null) => void,
  ) {}

  provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
    const found = linksOn(this.term.buffer.active, this.term.cols, y - 1)
    callback(
      found.length
        ? found.map(({ text, start, end }) => ({
            text,
            range: {
              start: { x: start.x + 1, y: start.y + 1 },
              end: { x: end.x + 1, y: end.y + 1 },
            },
            activate: () => undefined,
            hover: (_event: MouseEvent, uri: string) => this.pointed(uri),
            leave: () => this.pointed(null),
          }))
        : undefined,
    )
  }
}

export function chosenText(term: Terminal): string {
  const range = term.getSelectionPosition()
  const whole = range && unbroken(term.buffer.active, term.cols, range.start, range.end)
  return whole ?? term.getSelection()
}
