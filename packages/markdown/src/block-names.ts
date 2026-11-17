import {
  blockIdOf,
  heldBlocks,
  isHeading,
  itemLines,
  LIST_ITEM,
  ownLine,
  type Row,
  rowsOf,
} from './links'

const RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|=+[ \t]*)$/u

const TABLE_RULE = /^[\s|:-]*-[\s|:-]*$/u

function nameStandsApart(run: readonly Row[]): boolean {
  const last = run.at(-1)?.text.trimEnd() ?? ''
  if (run.at(-1)?.code) return true
  if (/^ {0,3}(?:\||\$\$|<)/u.test(last) || /(?:\||\$\$|>)$/u.test(last) || RULE.test(last)) {
    return true
  }
  return run.some((row) => row.text.includes('|') && TABLE_RULE.test(row.text))
}

function listed(row: Row | undefined): boolean {
  return !!row && !row.code && LIST_ITEM.test(row.text)
}

function endOf(rows: readonly Row[], line: number): number {
  const held = heldBlocks(rows).get(line)
  if (held?.first === line) return held.last

  let end = line
  for (;;) {
    const next = rows[end + 1]
    if (!next) return end
    if (rows[end]?.code ? !next.code : !next.text.trim() || listed(next) || isHeading(next.text)) {
      return end
    }
    end++
  }
}

export function namedBlock(
  source: string,
  line: number,
  id: () => string,
): { id: string; source: string } | null {
  const rows = rowsOf(source)
  const row = rows[line]
  if (!row || row.matter || (!row.code && isHeading(row.text))) return null
  if (listed(row)) return namedItem(rows, source, line, id)
  const item = row.code ? itemLines(rows, line) : null
  if (item) return namedItem(rows, source, item.first, id)

  const from = heldBlocks(rows).get(line)?.first ?? line
  const end = endOf(rows, from)
  const lines = source.split('\n')
  const last = lines[end] ?? ''
  const ending = last.endsWith('\r') ? '\r' : ''

  const under = rows.slice(end + 1).find((one) => one.text.trim())
  const had =
    (under && !under.code && ownLine(under.text) ? blockIdOf(under.text) : null) ??
    (rows[end]?.code ? (rows[end].fenceName ?? null) : blockIdOf(last))
  if (had) return { id: had, source }

  const name = id()
  if (nameStandsApart(rows.slice(from, end + 1))) {
    const beneath = (rows[end + 1]?.text.trim() ?? '') === '' ? [] : [ending]
    lines.splice(end + 1, 0, ending, `^${name}${ending}`, ...beneath)
  } else {
    lines[end] = `${last.trimEnd()} ^${name}${ending}`
  }
  return { id: name, source: lines.join('\n') }
}

function namedItem(
  rows: readonly Row[],
  source: string,
  line: number,
  id: () => string,
): { id: string; source: string } {
  const lines = source.split('\n')
  const item = itemLines(rows, line)
  let end = line
  while (item && end < item.last && !listed(rows[end + 1]) && !rows[end + 1]?.code) end++

  for (let at = line; at <= end; at++) {
    const had = blockIdOf(lines[at] ?? '')
    if (had) return { id: had, source }
  }

  const name = id()
  const last = lines[end] ?? ''
  lines[end] = `${last.trimEnd()} ^${name}${last.endsWith('\r') ? '\r' : ''}`
  return { id: name, source: lines.join('\n') }
}
