/** Turning the matches in one note into the edit that replaces them.
 *
 *  Edits and not a rewritten string, because a note open in a pane takes them
 *  as edits: replacing the whole text would sweep every caret in every pane to
 *  the end of it, and a change set the size of the words that changed carries
 *  each caret through untouched. The rewritten string comes out of the same
 *  edits, for the file. */

import type { Change } from './apply'
import { lineAt, lineStarts } from './lines'
import type { Span } from './match'

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

/** The edits that rewrite the note; see `changeOf` for the note they leave. Null
 *  when nothing on the kept lines matched, so a caller writes no file and takes no
 *  snapshot.
 *
 *  Two operators that found the same words replace them once: the edits are in
 *  the order they sit in the note and never overlap. */
export function replaceIn(
  body: string,
  spans: readonly Span[],
  lines: ReadonlySet<number>,
  replacement: string,
): Edit[] | null {
  const starts = lineStarts(body)
  const wanted = spans
    // A span of no width is where a filter put a row, as `task-todo:` alone does
    // at each task, and not words that answered: replacing it would write the
    // replacement in front of every task.
    .filter((span) => span.from < span.to && lines.has(lineAt(starts, span.from)))
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

  return edits.length ? edits : null
}

/** The note as the edits leave it. They are in the order they sit in the note and
 *  never overlap, which every caller here holds to. */
export function applied(body: string, edits: readonly Edit[]): string {
  let text = ''
  let at = 0
  for (const edit of edits) {
    text += body.slice(at, edit.from) + edit.insert
    at = edit.to
  }

  return text + body.slice(at)
}

/** One note's change, whole, from the edits that make it: what the workspace writes,
 *  snapshots and records as one thing to undo. Every road that writes words into
 *  notes without opening them hands it one of these - a replacement, a tag renamed,
 *  an icon, a cover, a syntax converted, a hover card. */
export function changeOf(path: string, before: string, edits: Edit[]): Change {
  return { path, before, after: applied(before, edits), edits, back: reverse(before, edits) }
}

/** A file's words as `like` would say them: with one line ending where `like` was worked
 *  out on one, as an agent's edits are, or a file with Windows ones differs on every
 *  line. */
export function endingsLike(words: string, like: string): string {
  return like.includes('\r') || !words.includes('\r') ? words : words.replace(/\r\n?/g, '\n')
}

/** Whether the first line ending of a file is `\r\n`, which has the disk write every
 *  line that way; see `as_written` in notes.rs. */
function crlfFirst(file: string): boolean {
  const first = file.indexOf('\n')
  return first > 0 && file[first - 1] === '\r'
}

/** Edits worked out on a file's words with one line ending, applied to the file itself:
 *  a line they do not touch stays as it was where the disk keeps it, and one they add
 *  ends as the disk would end it. A file that starts with `\r\n` and has a bare `\n`
 *  further down comes out all `\r\n` from the disk, as it does from a save in a tab. */
export function appliedToFile(file: string, edits: readonly Edit[]): string {
  const crlf = crlfFirst(file)
  let raw = 0
  let flat = 0
  const seek = (to: number) => {
    for (; flat < to; flat++) raw += file[raw] === '\r' && file[raw + 1] === '\n' ? 2 : 1
    return raw
  }

  let out = ''
  let last = 0
  for (const edit of edits) {
    out += file.slice(last, seek(edit.from))
    out += crlf ? edit.insert.replace(/\r?\n/g, '\r\n') : edit.insert
    last = seek(edit.to)
  }
  return out + file.slice(last)
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
