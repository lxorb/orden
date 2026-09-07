/** Turning the matches in one note into the edit that replaces them.
 *
 *  Edits and not a rewritten string, because a note open in a pane takes them
 *  as edits: replacing the whole text would sweep every caret in every pane to
 *  the end of it, and a change set the size of the words that changed carries
 *  each caret through untouched. The rewritten string comes out of the same
 *  edits, for the file. */

import { lineAt, lineStarts, type Span } from './match'

export interface Edit {
  from: number
  to: number
  insert: string
}

/** What a `/re/` caught, put back into the replacement: `$1` to `$9` for the
 *  groups, `$&` for the whole match, `$$` for a dollar. A plain word catches
 *  nothing, and after one `$1` is only those two characters. */
export function expand(
  replacement: string,
  matched: string,
  groups: readonly string[] | undefined,
): string {
  if (!groups) return replacement

  return replacement.replace(/\$(\$|&|\d)/g, (whole, what: string) => {
    if (what === '$') return '$'
    if (what === '&') return matched

    return groups[Number(what) - 1] ?? whole
  })
}

/** The note rewritten, and the edits that rewrote it. Null when nothing on the
 *  kept lines matched, so a caller writes no file and takes no snapshot.
 *
 *  Two operators that found the same words replace them once: the edits are in
 *  the order they sit in the note and never overlap. */
export function replaceIn(
  body: string,
  spans: readonly Span[],
  lines: ReadonlySet<number>,
  replacement: string,
): { text: string; edits: Edit[] } | null {
  const starts = lineStarts(body)
  const wanted = spans
    .filter((span) => lines.has(lineAt(starts, span.from)))
    .sort((a, b) => a.from - b.from || b.to - a.to)

  const edits: Edit[] = []
  let reached = 0

  for (const span of wanted) {
    if (span.from < reached) continue

    edits.push({
      from: span.from,
      to: span.to,
      insert: expand(replacement, body.slice(span.from, span.to), span.groups),
    })
    reached = span.to
  }

  if (!edits.length) return null

  let text = ''
  let at = 0
  for (const edit of edits) {
    text += body.slice(at, edit.from) + edit.insert
    at = edit.to
  }

  return { text: text + body.slice(at), edits }
}

/** The edits that put a replacement back, in the coordinates of the note the
 *  replacement left behind. Undoing is then the same kind of change the
 *  replacement was, which is what keeps the carets in an open pane where their
 *  readers left them. */
export function reverse(body: string, edits: readonly Edit[]): Edit[] {
  let drift = 0

  return edits.map((edit) => {
    const from = edit.from + drift
    const to = from + edit.insert.length
    drift += edit.insert.length - (edit.to - edit.from)

    return { from, to, insert: body.slice(edit.from, edit.to) }
  })
}
