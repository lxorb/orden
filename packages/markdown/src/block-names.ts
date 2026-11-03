/** A block given its name in a note that is not open: fetched by the one row that asks,
 *  a block picked after `#^`. The editor names the block it holds by its own tree; see
 *  `blockTarget` in @orden/editor. */

import { blockIdOf, ownLine, type Row, rowsOf } from './links'

/** Whether a block starting at this row takes its name on a line of its own: on the
 *  last line of a fence, a table, maths, a rule or HTML a name is no name, and breaks
 *  what it is written on. A closing fence with words after it closes nothing. A blank
 *  line above it, since under a table without one it is a row. Obsidian's own rule. */
function nameStandsApart(row: Row, next: string): boolean {
  if (row.code) return true
  if (/^ {0,3}(?:\||\$\$|<)/u.test(row.text)) return true
  if (/^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/u.test(row.text.trimEnd())) {
    return true
  }
  return next.includes('|') && /^[\s|:-]*-[\s|:-]*$/u.test(next)
}

/** The block starting at a line, named: what the note says with the name in it, the
 *  note as it stands when the block has one already, and null where it can have none.
 *  `id` is asked only for a name that is going to be written. */
export function namedBlock(
  source: string,
  line: number,
  id: () => string,
): { id: string; source: string } | null {
  const rows = rowsOf(source)
  const row = rows[line]
  if (!row || row.matter) return null

  // The end of the run of lines the block is; a fence's own blank lines and all, and
  // no further than the fence.
  let end = line
  for (;;) {
    const next = rows[end + 1]
    if (!next) break
    if (rows[end]?.code ? !next.code : !next.text.trim()) break
    end++
  }

  const lines = source.split('\n')
  const last = lines[end] ?? ''
  const ending = last.endsWith('\r') ? '\r' : ''

  if (nameStandsApart(row, rows[line + 1]?.text ?? '')) {
    const written = rows.slice(end + 1).find((one) => one.text.trim())
    const had = written && ownLine(written.text) ? blockIdOf(written.text) : null
    if (had) return { id: had, source }

    const name = id()
    const beneath = (rows[end + 1]?.text.trim() ?? '') === '' ? [] : [ending]
    lines.splice(end + 1, 0, ending, `^${name}${ending}`, ...beneath)
    return { id: name, source: lines.join('\n') }
  }

  const had = blockIdOf(last)
  if (had) return { id: had, source }

  const name = id()
  // A CRLF note's `\r` stays on the line named, as on every other.
  lines[end] = `${last.trimEnd()} ^${name}${ending}`
  return { id: name, source: lines.join('\n') }
}
