export type Align = 'left' | 'center' | 'right' | null

export interface TableModel {
  header: string[]
  align: Align[]
  rows: string[][]
}

/** Counts CJK and emoji as two columns so pipe-aligned source stays aligned. */
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
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''

  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === '|') {
      current += '\\|'
      i++
      continue
    }
    if (body[i] === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += body[i]
  }

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
  if (lines.length < 2 || !isDelimiterRow(lines[1])) return null

  const header = splitRow(lines[0])
  const align = splitRow(lines[1]).map(readAlign)
  const rows = lines.slice(2).map((line) => splitRow(line))

  // Ragged rows are legal markdown; normalise so the model is rectangular.
  const columns = Math.max(header.length, align.length, ...rows.map((row) => row.length))
  const fit = (row: string[]) => Array.from({ length: columns }, (_, i) => row[i] ?? '')

  return {
    header: fit(header),
    align: Array.from({ length: columns }, (_, i) => align[i] ?? null),
    rows: rows.map(fit),
  }
}

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
    default:
      return '-'.repeat(Math.max(3, width))
  }
}

/** Writes the table back as pipe-aligned markdown, the way Typora formats it. */
export function serializeTable(model: TableModel): string {
  const columns = model.header.length
  const widths = Array.from({ length: columns }, (_, i) =>
    Math.max(
      3,
      displayWidth(model.header[i] ?? ''),
      ...model.rows.map((row) => displayWidth(row[i] ?? '')),
    ),
  )

  const row = (cells: string[]) =>
    `| ${cells.map((cell, i) => padCell(cell ?? '', widths[i])).join(' | ')} |`

  return [
    row(model.header),
    `| ${model.align.map((align, i) => delimiterCell(align, widths[i])).join(' | ')} |`,
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
  return { ...model, rows: withRemoved(model.rows, at) }
}

export function moveRow(model: TableModel, from: number, to: number): TableModel {
  if (to < 0 || to >= model.rows.length) return model
  const rows = [...model.rows]
  const [moved] = rows.splice(from, 1)
  rows.splice(to, 0, moved)
  return { ...model, rows }
}

export function moveColumn(model: TableModel, from: number, to: number): TableModel {
  if (to < 0 || to >= model.header.length) return model
  const swap = <T>(list: T[]) => {
    const next = [...list]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    return next
  }
  return {
    header: swap(model.header),
    align: swap(model.align),
    rows: model.rows.map(swap),
  }
}

export function setAlign(model: TableModel, column: number, align: Align): TableModel {
  const next = [...model.align]
  next[column] = align
  return { ...model, align: next }
}

export function setCell(model: TableModel, row: number, column: number, value: string): TableModel {
  // The source is one line per row, so a newline typed into a cell would split it.
  const clean = value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')

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
