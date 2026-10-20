/** A CSV read properly, because two of these exports are CSV.
 *
 *  Notion writes one per database and Airtable writes one per table, and both
 *  hold cells with commas in them, cells with quotes in them, and cells with
 *  whole paragraphs and their newlines in them. The editor's paste already
 *  splits a pasted table on commas, but that is a different job: what is pasted
 *  is usually three tidy columns out of a spreadsheet, and what is exported is a
 *  database somebody has been typing into for four years.
 *
 *  So: RFC 4180, with the one liberty every reader takes, which is that a lone
 *  quote in the middle of an unquoted cell is a quote and not an error. */

/** The three characters a spreadsheet might have separated cells with. The
 *  header row is asked which, because a table of prose is full of commas and a
 *  table of European numbers is full of semicolons. */
const MAYBE = [',', ';', '\t'] as const

/** The line Excel writes above the header to say which separator follows, and
 *  reads to know it: `sep=;`. */
const SEP = /^"?sep=(.)"?[^\S\r\n]*(\r\n|\r|\n|$)/i

export function readCsv(text: string): string[][] {
  return parsed(text).rows
}

/** The rows, and the separator that divided them. */
function parsed(text: string): { rows: string[][]; delimiter: string } {
  // Excel writes a byte order mark in front of the header, which would otherwise
  // become part of the first column's name and so of every row's first property.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const said = SEP.exec(body)
  if (said) {
    const delimiter = said[1] ?? ','
    return { rows: rows(body.slice(said[0].length), delimiter), delimiter }
  }

  const delimiter = delimiterOf(body)
  return { rows: rows(body, delimiter), delimiter }
}

/** Which separator the file uses: whichever divides the first line into the
 *  most cells, counting only the ones outside quotes. A tie goes to the comma,
 *  which is what the C in CSV is. */
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

/** The first line with a word on it, counting a quoted newline as part of the
 *  line it is in: the header, under the blank rows a spreadsheet may start with. */
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
  // Where the open quote was, for a file that ends inside it.
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
        // Two quotes inside a quoted cell are one quote in the text.
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

  // A quote that opens a cell and is never closed would make one cell of the rest
  // of the file, every row after it inside it. No later quote closed it, so it can
  // only have been a quote somebody typed: the file is read again with that one
  // quote as a character.
  if (quoted) return rows(text, delimiter, new Set([...literal, opened]))

  // A file that ends with a newline has no last row; one that does not, does.
  if (cell || row.length) endRow()

  return out
}

/** The rows as records under the header's own names, which is what a database
 *  row is: a note's worth of properties. An empty header column is dropped, so a
 *  trailing comma in the header does not become a property called nothing. */
export function recordsOf(text: string): { columns: string[]; rows: Record<string, string>[] } {
  const { rows: read, delimiter } = parsed(text)
  // The header is the first row with anything in it: a spreadsheet saved with an
  // empty row or two above its table writes them as lines of nothing, or of commas.
  const table = read.slice(
    Math.max(
      0,
      read.findIndex((line) => line.some((cell) => cell.trim())),
    ),
  )
  const head = table[0]
  if (!head) return { columns: [], rows: [] }

  // Two columns of one name would be one property, and the second would write over
  // the first in every row: the second is `Notes 2`, the way a note's name steps aside.
  const seen = new Set<string>()
  const columns = head.map((one) => {
    const name = one.trim()
    if (!name) return name
    let free = name
    for (let step = 2; seen.has(free.toLowerCase()); step += 1) free = `${name} ${step}`
    seen.add(free.toLowerCase())
    return free
  })
  const found: Record<string, string>[] = []

  for (const line of table.slice(1)) {
    // A row of nothing is what a blank line at the end of the file looks like.
    if (line.every((cell) => !cell.trim())) continue

    const record: Record<string, string> = {}
    for (const [at, column] of columns.entries()) if (column) record[column] = line[at] ?? ''

    // More cells than the header has columns is a separator somebody typed into a
    // cell that was not quoted, nearly always in the last one, where the free text
    // goes. The cells over are put back into it as they were written rather than
    // left out.
    const over = line.slice(columns.length)
    while (over.length && !over[over.length - 1]?.trim()) over.pop()
    const last = columns[columns.length - 1]
    if (over.length && last) record[last] = [record[last] ?? '', ...over].join(delimiter)

    found.push(record)
  }

  return { columns: columns.filter(Boolean), rows: found }
}
