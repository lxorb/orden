/** A block given its name in a note that is not open: fetched by the one row that asks,
 *  a block picked after `#^`. The editor names the block it holds by its own tree; see
 *  `blockTarget` in @orden/editor. */

import { blockIdOf, ownLine, type Row, rowsOf } from './links'

/** A rule, or the underline of a heading. */
const RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|=+[ \t]*)$/u

/** The line of dashes a table has under its head. */
const TABLE_RULE = /^[\s|:-]*-[\s|:-]*$/u

/** Whether a run of lines ends in something a name cannot be written on: on a closing
 *  fence, a table row, a rule, maths or HTML a name is no name, and breaks what it is
 *  written on. A closing fence with words after it closes nothing. So it goes under
 *  the block with a blank line above it, or under a table it is a row; Obsidian's rule. */
function nameStandsApart(run: readonly Row[]): boolean {
  const last = run.at(-1)?.text.trimEnd() ?? ''
  if (run.at(-1)?.code) return true
  if (/^ {0,3}(?:\||\$\$|<)/u.test(last) || /(?:\||\$\$|>)$/u.test(last) || RULE.test(last)) {
    return true
  }
  return run.some((row) => row.text.includes('|') && TABLE_RULE.test(row.text))
}

/** Blocks that run past their blank lines to a closer of their own. */
const CLOSERS: readonly (readonly [RegExp, string])[] = [
  [/^ {0,3}\$\$\s*$/u, '$$'],
  [/^ {0,3}<!--/u, '-->'],
  [/^ {0,3}<(?:pre|script|style)\b/iu, '</'],
]

/** Where the block starting at a line ends: the run of lines it is, a fence's own blank
 *  lines and all and no further than the fence, and maths or a comment to its closer. */
function endOf(rows: readonly Row[], line: number): number {
  const first = rows[line]?.text ?? ''
  const closer = CLOSERS.find(([opens]) => opens.test(first))?.[1]
  if (closer !== undefined && !first.slice(first.indexOf(closer) + 1).includes(closer)) {
    for (let at = line + 1; at < rows.length; at++) {
      if (rows[at]?.text.includes(closer)) return at
    }
  }

  let end = line
  for (;;) {
    const next = rows[end + 1]
    if (!next) return end
    if (rows[end]?.code ? !next.code : !next.text.trim()) return end
    end++
  }
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

  const end = endOf(rows, line)
  const lines = source.split('\n')
  const last = lines[end] ?? ''
  const ending = last.endsWith('\r') ? '\r' : ''

  // A name the block has on a line of its own under it, or on its last line.
  const under = rows.slice(end + 1).find((one) => one.text.trim())
  const had =
    (under && !under.code && ownLine(under.text) ? blockIdOf(under.text) : null) ??
    (rows[end]?.code ? null : blockIdOf(last))
  if (had) return { id: had, source }

  const name = id()
  if (nameStandsApart(rows.slice(line, end + 1))) {
    const beneath = (rows[end + 1]?.text.trim() ?? '') === '' ? [] : [ending]
    lines.splice(end + 1, 0, ending, `^${name}${ending}`, ...beneath)
    return { id: name, source: lines.join('\n') }
  }

  // A CRLF note's `\r` stays on the line named, as on every other.
  lines[end] = `${last.trimEnd()} ^${name}${ending}`
  return { id: name, source: lines.join('\n') }
}
