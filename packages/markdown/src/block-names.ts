import {
  blockAround,
  blockIdOf,
  indentOf,
  itemColumn,
  itemHolding,
  ownLine,
  type Row,
  leadTo,
  rowsOf,
} from './links'

const RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|=+[ \t]*)\r?$/u

const AN_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/u

const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/u

const QUOTE = /^ {0,3}>/u

const FENCE = /^ {0,3}(?:`{3,}|~{3,})/u

const BREAK = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})\r?$/u

const TABLE_RULE = /^[\s|:-]*-[\s|:-]*$/u

function nameStandsApart(run: readonly Row[]): boolean {
  const last = run.at(-1)?.text.trimEnd() ?? ''
  if (run.at(-1)?.code) return true
  if (/^ {0,3}(?:\||\$\$|<)/u.test(last) || /(?:\||\$\$|>)$/u.test(last) || RULE.test(last)) {
    return true
  }
  return run.some((row) => row.text.includes('|') && TABLE_RULE.test(row.text))
}

const CLOSERS: readonly (readonly [RegExp, string])[] = [
  [/^ {0,3}\$\$\s*$/u, '$$'],
  [/^ {0,3}<!--/u, '-->'],
  [/^ {0,3}<(?:pre|script|style)\b/iu, '</'],
]

function itemEnd(rows: readonly Row[], owner: number): number {
  const depth = indentOf(rows[owner]?.text ?? '')
  let end = owner
  let inCode = false
  for (let at = owner + 1; at < rows.length; at++) {
    const next = rows[at]
    if (!next) break
    if (next.code) {
      if (!inCode && indentOf(next.text) <= depth) break
      inCode = true
      end = at
      continue
    }
    inCode = false
    if (!next.text.trim() || AN_ITEM.test(next.text)) break
    end = at
  }
  return end
}

function endOf(rows: readonly Row[], line: number): number {
  const first = rows[line]?.text ?? ''
  const closer = CLOSERS.find(([opens]) => opens.test(first))?.[1]
  if (closer !== undefined && !first.slice(first.indexOf(closer) + 1).includes(closer)) {
    for (let at = line + 1; at < rows.length; at++) {
      if (rows[at]?.text.includes(closer)) return at
    }
  }

  if (!rows[line]?.code && HEADING.test(first)) return line

  let end = line
  for (;;) {
    const here = rows[end]
    const next = rows[end + 1]
    if (!next) return end
    if (here?.code ? !next.code : !next.text.trim()) return end
    if (!next.code && (AN_ITEM.test(next.text) || HEADING.test(next.text))) return end
    if (!here?.code && next.code && FENCE.test(next.text)) return end
    if (!here?.code && !next.code && !QUOTE.test(here?.text ?? '') && BREAK.test(next.text)) {
      return end
    }
    if (!here?.code && !next.code && QUOTE.test(next.text) !== QUOTE.test(here?.text ?? '')) {
      return end
    }
    end++
  }
}

function codeOwner(rows: readonly Row[], lines: readonly string[], line: number): number | null {
  let fence = line
  while (fence > 0 && rows[fence - 1]?.code) fence--
  const above = fence - 1
  if (above < 0 || !(lines[above] ?? '').trim()) return null
  const owner = itemHolding(lines, above)
  if (owner === null) return null
  return indentOf(lines[fence] ?? '') > indentOf(lines[owner] ?? '') ? owner : null
}

function namedItem(
  rows: readonly Row[],
  lines: string[],
  owner: number,
  id: () => string,
): { id: string; source: string } {
  const end = itemEnd(rows, owner)
  const run = rows.slice(owner, end + 1)
  const had = run.map((row) => (row.code ? null : blockIdOf(row.text))).find(Boolean)
  if (had) return { id: had, source: lines.join('\n') }

  const name = id()
  const at = nameStandsApart(run) ? owner : end
  const line = lines[at] ?? ''
  const ending = line.endsWith('\r') ? '\r' : ''
  lines[at] = `${line.trimEnd()} ^${name}${ending}`
  return { id: name, source: lines.join('\n') }
}

export function namedBlock(
  source: string,
  line: number,
  id: () => string,
): { id: string; source: string } | null {
  const rows = rowsOf(source)
  const row = rows[line]
  if (!row || row.matter) return null

  const lines = source.split('\n')
  const owner = row.code ? codeOwner(rows, lines, line) : itemHolding(lines, line)
  if (owner !== null) return namedItem(rows, lines, owner, id)

  const end = endOf(rows, line)
  const start = Math.min(line, blockAround(rows, line).start)
  const last = lines[end] ?? ''
  const ending = last.endsWith('\r') ? '\r' : ''

  const under = rows.slice(end + 1).find((one) => one.text.trim())
  const had =
    (under && !under.code && ownLine(under.text) ? blockIdOf(under.text) : null) ??
    (rows[end]?.code ? null : blockIdOf(last))
  if (had) return { id: had, source }

  const name = id()
  if (nameStandsApart(rows.slice(start, end + 1))) {
    const beneath = (rows[end + 1]?.text.trim() ?? '') === '' ? [] : [ending]
    const lead = leadTo(lines[start] ?? '', itemColumn(lines, start))
    lines.splice(end + 1, 0, ending, `${lead}^${name}${ending}`, ...beneath)
  } else {
    lines[end] = `${last.trimEnd()} ^${name}${ending}`
  }
  return { id: name, source: lines.join('\n') }
}
