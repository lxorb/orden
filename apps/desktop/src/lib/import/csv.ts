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

export function readCsv(text: string): string[][] {
  // Excel writes a byte order mark in front of the header, which would otherwise
  // become part of the first column's name and so of every row's first property.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return rows(body, delimiterOf(body))
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

/** The first line, counting a quoted newline as part of the line it is in. */
function firstLine(text: string): string {
  let quoted = false

  for (let at = 0; at < text.length; at += 1) {
    const one = text[at]
    if (one === '"') quoted = !quoted
    else if (!quoted && (one === '\n' || one === '\r')) return text.slice(0, at)
  }

  return text
}

function rows(text: string, delimiter: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let at = 0

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

    if (one === '"' && !cell) {
      quoted = true
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

  // A file that ends with a newline has no last row; one that does not, does.
  if (cell || row.length) endRow()

  return out
}

/** The rows as records under the header's own names, which is what a database
 *  row is: a note's worth of properties. An empty header column is dropped, so a
 *  trailing comma in the header does not become a property called nothing. */
export function recordsOf(text: string): { columns: string[]; rows: Record<string, string>[] } {
  const table = readCsv(text)
  const head = table[0]
  if (!head) return { columns: [], rows: [] }

  const columns = head.map((one) => one.trim())
  const found: Record<string, string>[] = []

  for (const line of table.slice(1)) {
    // A row of nothing is what a blank line at the end of the file looks like.
    if (line.every((cell) => !cell.trim())) continue

    const record: Record<string, string> = {}
    for (const [at, column] of columns.entries()) if (column) record[column] = line[at] ?? ''
    found.push(record)
  }

  return { columns: columns.filter(Boolean), rows: found }
}
