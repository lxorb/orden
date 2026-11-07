export function csvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  while (i < text.length) {
    const c = text.charAt(i)
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
      } else {
        cell += c
      }
      i++
      continue
    }
    if (c === '"' && cell === '') {
      quoted = true
    } else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\r' || c === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      if (c === '\r' && text[i + 1] === '\n') i++
    } else {
      cell += c
    }
    i++
  }
  if (cell !== '' || row.length > 0 || quoted) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? '') !== '')
}

export type CsvRecord = Record<string, string>

export function csvRecords(text: string): CsvRecord[] {
  const [head, ...body] = csvRows(text)
  if (!head) return []
  const names = head.map((name) => name.trim())
  return body.map((cells) => {
    const record: CsvRecord = {}
    names.forEach((name, i) => {
      if (!(name in record) || record[name] === '') record[name] = cells[i] ?? ''
    })
    return record
  })
}

export function csvHeader(text: string): string[] {
  return (csvRows(text)[0] ?? []).map((name) => name.trim())
}

export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function csvText(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
