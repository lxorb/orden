import {
  blockIdOf,
  heldBlocks,
  isHeading,
  leadTo,
  nameIndent,
  itemLines,
  layoutOf,
  LIST_ITEM,
  openFenceIn,
  ownLine,
  quoteAround,
  quotedRows,
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
const listed = (row: Row | undefined): boolean => !!row && !row.code && LIST_ITEM.test(row.text)
function endOf(rows: readonly Row[], line: number): number {
  const { held: blocks, goesOn, runOf } = layoutOf(rows)
  const quoted = quotedRows(rows)
  const held = blocks.get(line)
  if (held?.first === line) return held.last
  const quote = quoteAround(rows, line)
  if (quote) return quote.last
  let end = line
  for (;;) {
    const next = rows[end + 1]
    if (!next) return end
    if (rows[end]?.code) {
      if (!next.code || runOf[end + 1] !== runOf[end] || !goesOn[end + 1]) return end
    } else if (
      blocks.has(end + 1) ||
      (!quoted[end] && quoted[end + 1]) ||
      next.code ||
      !next.text.trim() ||
      listed(next) ||
      isHeading(next.text)
    ) {
      return end
    }
    end++
  }
}
export function namedBlock(source: string, line: number, id: () => string): { id: string; source: string } | null {
  const rows = rowsOf(source)
  const row = rows[line]
  if (!row || row.matter) return null
  const blocks = heldBlocks(rows)
  const plain = !row.code && !blocks.has(line)
  if (plain && isHeading(row.text)) return null
  if (plain && listed(row)) return namedItem(rows, source, line, id)
  const item = itemLines(rows, line)
  if (item && item.first !== line) return namedItem(rows, source, item.first, id)
  const from = blocks.get(line)?.first ?? quoteAround(rows, line)?.first ?? line
  const end = endOf(rows, from)
  if (openFenceIn(rows, from, end)) return null
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
    const below = rows[end + 1]
    const indent = leadTo(rows[from]?.text ?? '', nameIndent(rows, from).length)
    const joins = (below?.text.trim() ?? '') === '' || (indent !== '' && listed(below))
    lines.splice(end + 1, 0, ending, `${indent}^${name}${ending}`, ...(joins ? [] : [ending]))
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
  const blocks = heldBlocks(rows)
  let end = line
  while (
    item &&
    end < item.last &&
    !listed(rows[end + 1]) &&
    !rows[end + 1]?.code &&
    !blocks.has(end + 1) &&
    !isHeading((rows[end + 1]?.text ?? '').trim()) &&
    rows[end + 1]?.text.trim() &&
    !/^\s*[|>]/u.test(rows[end + 1]?.text ?? '') &&
    !RULE.test((rows[end + 1]?.text ?? '').trim())
  ) {
    end++
  }
  for (let at = line; at <= end; at++) {
    const had = blockIdOf(lines[at] ?? '')
    if (had) return { id: had, source }
  }
  const name = id()
  const last = lines[end] ?? ''
  lines[end] = `${last.trimEnd()} ^${name}${last.endsWith('\r') ? '\r' : ''}`
  return { id: name, source: lines.join('\n') }
}
