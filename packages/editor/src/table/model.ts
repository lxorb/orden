export type Align = 'left' | 'center' | 'right' | null

export interface TableModel {
  header: string[]
  align: Align[]
  rows: string[][]
}

export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff)
    width += wide ? 2 : 1
  }
  return width
}

function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, '')
  const cells: string[] = []
  let current = ''

  for (let i = 0; i < body.length; i++) {
    const character = body.charAt(i)
    if (character === '\\' && (body.charAt(i + 1) === '|' || body.charAt(i + 1) === '\\')) {
      current += character + body.charAt(i + 1)
      i++
      continue
    }
    if (character === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += character
  }

  if (!current && cells.length) return cells

  cells.push(current.trim())
  return cells
}

function readAlign(cell: string): Align {
  const text = cell.trim()
  const left = text.startsWith(':')
  const right = text.endsWith(':')
  if (left && right) return 'center'
  if (left) return 'left'
  if (right) return 'right'
  return null
}

function isDelimiterRow(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line)
}

export function parseTable(source: string): TableModel | null {
  const lines = source.split('\n').filter((line) => line.trim().length > 0)
  const [headerLine, delimiterLine, ...bodyLines] = lines
  if (headerLine === undefined || delimiterLine === undefined) return null
  if (!isDelimiterRow(delimiterLine)) return null

  const header = splitRow(headerLine)
  const align = splitRow(delimiterLine).map(readAlign)
  const rows = bodyLines.map((line) => splitRow(line))

  const columns = rows.reduce(
    (most, row) => Math.max(most, row.length),
    Math.max(header.length, align.length),
  )
  const fit = (row: string[]) => Array.from({ length: columns }, (_, i) => row[i] ?? '')

  return {
    header: fit(header),
    align: Array.from({ length: columns }, (_, i) => align[i] ?? null),
    rows: rows.map(fit),
  }
}

const MIN_CELL = 3

function padCell(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)))
}

function delimiterCell(align: Align, width: number): string {
  switch (align) {
    case 'left':
      return `:${'-'.repeat(Math.max(1, width - 1))}`
    case 'right':
      return `${'-'.repeat(Math.max(1, width - 1))}:`
    case 'center':
      return `:${'-'.repeat(Math.max(1, width - 2))}:`
    case null:
      return '-'.repeat(Math.max(MIN_CELL, width))
  }
}

export function serializeTable(model: TableModel): string {
  const columns = Math.max(model.header.length, model.align.length)
  const widths = Array.from({ length: columns }, (_, i) =>
    model.rows.reduce(
      (most, row) => Math.max(most, displayWidth(row[i] ?? '')),
      Math.max(MIN_CELL, displayWidth(model.header[i] ?? '')),
    ),
  )

  const row = (cells: readonly string[]) =>
    `| ${widths.map((width, i) => padCell(cells[i] ?? '', width)).join(' | ')} |`

  return [
    row(model.header),
    `| ${widths.map((width, i) => delimiterCell(model.align[i] ?? null, width)).join(' | ')} |`,
    ...model.rows.map(row),
  ].join('\n')
}

export function insertColumn(model: TableModel, at: number): TableModel {
  return {
    header: withInserted(model.header, at, ''),
    align: withInserted(model.align, at, null),
    rows: model.rows.map((row) => withInserted(row, at, '')),
  }
}

export function removeColumn(model: TableModel, at: number): TableModel {
  if (at < 0 || at >= model.header.length) return model
  if (model.header.length <= 1) return model
  return {
    header: withRemoved(model.header, at),
    align: withRemoved(model.align, at),
    rows: model.rows.map((row) => withRemoved(row, at)),
  }
}

export function insertRow(model: TableModel, at: number): TableModel {
  const blank = model.header.map(() => '')
  return { ...model, rows: withInserted(model.rows, at, blank) }
}

export function removeRow(model: TableModel, at: number): TableModel {
  if (at < 0 || at >= model.rows.length) return model
  return { ...model, rows: withRemoved(model.rows, at) }
}

export function moveRow(model: TableModel, from: number, to: number): TableModel {
  if (from < 0 || from >= model.rows.length) return model
  if (to < 0 || to >= model.rows.length) return model
  const rows = [...model.rows]
  const [moved] = rows.splice(from, 1)
  if (moved === undefined) return model
  rows.splice(to, 0, moved)
  return { ...model, rows }
}

export function moveColumn(model: TableModel, from: number, to: number): TableModel {
  if (from < 0 || from >= model.header.length) return model
  if (to < 0 || to >= model.header.length) return model
  const swap = <T>(list: T[]) => {
    const next = [...list]
    const [moved] = next.splice(from, 1)
    if (moved === undefined) return list
    next.splice(to, 0, moved)
    return next
  }
  return {
    header: swap(model.header),
    align: swap(model.align),
    rows: model.rows.map(swap),
  }
}

export type Order = 'up' | 'down'

function numberIn(cell: string): number | null {
  const bare = cell
    .trim()
    .replace(/^[\p{Sc}\s]+/u, '')
    .replace(/,/g, '')
  if (!/^[+-]?\d+(\.\d+)?%?$/.test(bare)) return null

  return Number(bare.replace(/%$/, ''))
}

function dateIn(cell: string): number | null {
  const said = cell.trim()
  if (!/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(said)) return null

  const at = Date.parse(said)
  return Number.isNaN(at) ? null : at
}

function compareCells(left: string, right: string): number {
  const empty = (one: string) => one.trim() === ''
  if (empty(left) || empty(right)) return empty(left) ? (empty(right) ? 0 : 1) : -1

  const oneNumber = numberIn(left)
  const otherNumber = numberIn(right)
  if (oneNumber !== null && otherNumber !== null) return oneNumber - otherNumber
  if (oneNumber !== null || otherNumber !== null) return oneNumber !== null ? -1 : 1

  const oneDate = dateIn(left)
  const otherDate = dateIn(right)
  if (oneDate !== null && otherDate !== null) return oneDate - otherDate
  if (oneDate !== null || otherDate !== null) return oneDate !== null ? -1 : 1

  return left.trim().localeCompare(right.trim(), undefined, { numeric: true, sensitivity: 'base' })
}

export function sortRows(model: TableModel, column: number, order: Order): TableModel {
  if (column < 0 || column >= model.header.length) return model
  if (model.rows.length < 2) return model

  const way = order === 'up' ? 1 : -1
  const kept = model.rows.map((row, at) => ({ row, at }))

  kept.sort((left, right) => {
    const said = compareCells(left.row[column] ?? '', right.row[column] ?? '')
    if (said === 0) return left.at - right.at
    const blank = (one: string) => one.trim() === ''
    if (blank(left.row[column] ?? '') || blank(right.row[column] ?? '')) return said

    return said * way
  })

  const rows = kept.map((one) => one.row)
  return rows.every((row, at) => row === model.rows[at]) ? model : { ...model, rows }
}

export function setAlign(model: TableModel, column: number, align: Align): TableModel {
  const next = [...model.align]
  next[column] = align
  return { ...model, align: next }
}

export function setCell(model: TableModel, row: number, column: number, value: string): TableModel {
  const clean = value.replace(/\r?\n/g, ' ').replace(/\\?\|/g, '\\|')

  if (row < 0) {
    const header = [...model.header]
    header[column] = clean
    return { ...model, header }
  }

  const rows = model.rows.map((existing, i) =>
    i === row ? existing.map((cell, j) => (j === column ? clean : cell)) : existing,
  )
  return { ...model, rows }
}

function withInserted<T>(list: T[], at: number, value: T): T[] {
  const next = [...list]
  next.splice(at, 0, value)
  return next
}

function withRemoved<T>(list: T[], at: number): T[] {
  const next = [...list]
  next.splice(at, 1)
  return next
}
