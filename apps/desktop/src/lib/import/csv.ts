const MAYBE = [',', ';', '\t'] as const

const SEP = /^"?sep=(.)"?[^\S\r\n]*(\r\n|\r|\n|$)/i

export function readCsv(text: string): string[][] {
  return parsed(text).rows
}

function parsed(text: string): { rows: string[][]; delimiter: string } {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const said = SEP.exec(body)
  if (said) {
    const delimiter = said[1] ?? ','
    return { rows: rows(body.slice(said[0].length), delimiter), delimiter }
  }

  const delimiter = delimiterOf(body)
  return { rows: rows(body, delimiter), delimiter }
}

export function delimiterOf(text: string): string {
  const first = firstLine(text)
  let best = ','
  let most = 0

  for (const one of MAYBE) {
    const cells = rows(first, one)[0]?.length ?? 0
    if (cells > most) {
      most = cells
      best = one
    }
  }

  return best
}

function firstLine(text: string): string {
  let quoted = false
  let start = 0

  for (let at = 0; at < text.length; at += 1) {
    const one = text[at]
    if (one === '"') quoted = !quoted
    else if (!quoted && (one === '\n' || one === '\r')) {
      const line = text.slice(start, at)
      if (/[^,;\t\s"]/.test(line)) return line
      start = at + 1
    }
  }

  return text.slice(start)
}

function rows(
  text: string,
  delimiter: string,
  literal: ReadonlySet<number> = new Set(),
): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let at = 0
  let opened = -1

  const endCell = () => {
    row.push(cell)
    cell = ''
  }

  const endRow = () => {
    endCell()
    out.push(row)
    row = []
  }

  while (at < text.length) {
    const one = text[at] ?? ''

    if (quoted) {
      if (one === '"') {
        if (text[at + 1] === '"') {
          cell += '"'
          at += 2
          continue
        }
        quoted = false
        at += 1
        continue
      }

      cell += one
      at += 1
      continue
    }

    if (one === '"' && !cell && !literal.has(at)) {
      quoted = true
      opened = at
      at += 1
      continue
    }

    if (one === delimiter) {
      endCell()
      at += 1
      continue
    }

    if (one === '\r' || one === '\n') {
      endRow()
      at += one === '\r' && text[at + 1] === '\n' ? 2 : 1
      continue
    }

    cell += one
    at += 1
  }

  if (quoted) return rows(text, delimiter, new Set([...literal, opened]))

  if (cell || row.length) endRow()

  return out
}

export function recordsOf(text: string): { columns: string[]; rows: Record<string, string>[] } {
  const { rows: read, delimiter } = parsed(text)
  const table = read.slice(
    Math.max(
      0,
      read.findIndex((line) => line.some((cell) => cell.trim())),
    ),
  )
  const head = table[0]
  if (!head) return { columns: [], rows: [] }

  const seen = new Set<string>()
  const free = (name: string) => {
    let one = name
    for (let step = 2; seen.has(one.toLowerCase()); step += 1) one = `${name} ${step}`
    seen.add(one.toLowerCase())
    return one
  }
  const named = head.map((one) => (one.trim() ? free(one.trim()) : ''))
  const columns = named.map((name, at) =>
    name || !table.slice(1).some((line) => line[at]?.trim()) ? name : free(`Column ${at + 1}`),
  )
  const found: Record<string, string>[] = []

  for (const line of table.slice(1)) {
    if (line.every((cell) => !cell.trim())) continue

    const record: Record<string, string> = {}
    for (const [at, column] of columns.entries()) if (column) record[column] = line[at] ?? ''

    const over = line.slice(columns.length)
    while (over.length && !over[over.length - 1]?.trim()) over.pop()
    const last = columns[columns.length - 1]
    if (over.length && last) record[last] = [record[last] ?? '', ...over].join(delimiter)

    found.push(record)
  }

  return { columns: columns.filter(Boolean), rows: found }
}
