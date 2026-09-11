/** Finishing an operator, and its value from what the space actually holds.
 *
 *  `path:` offers the folders, `file:` the notes, `tag:` the tags. The operator's
 *  own name is offered too, which it was not when there were three of them: with
 *  `task-todo:` and `section:` among them the spelling is no longer something to
 *  guess at, and the one place a reminder belongs is where the typing is. Nothing
 *  is preselected for a name, though - a reader typing the word "task" gets the
 *  row offered and Enter still means Enter. See `OPERATORS` in query.ts, which is
 *  the list, and SearchPanel.svelte, which is what does not preselect it. */

import { fit } from './fuzzy'
import { OPERATORS } from './query'

type Field = 'path' | 'file' | 'tag'

/** What is being finished: an operator's value, or the operator's own name. */
type Finishing = Field | 'name'

/** The value being typed: which operator it belongs to and where it sits, so
 *  the chosen one goes back exactly where the typed one was. */
export interface Completing {
  field: Finishing
  typed: string
  from: number
  to: number
  /** True when the value is inside quotes, so a chosen one is not quoted twice. */
  quoted: boolean
}

/** A value already in quotes may hold spaces; a bare one ends at the first. */
const QUOTED = /(?:^|[\s(-])(path|file|tag):"([^"\n]*)$/i
const BARE = /(?:^|[\s(-])(path|file|tag):([^\s")]*)$/i

const FIELDS: readonly Field[] = ['path', 'file', 'tag']

/** A name being typed at the start of a term: after nothing, a space, a bracket
 *  or the `-` that excludes. Only offered when it could still become an operator,
 *  so an ordinary word opens nothing. */
const NAME = /(?:^|[\s(-])([A-Za-z][A-Za-z-]*)$/

/** What the caret is in the middle of finishing, or null when it is not in an
 *  operator's value. */
export function completing(source: string, caret: number): Completing | null {
  const before = source.slice(0, caret)
  const quoted = QUOTED.exec(before)
  const found = quoted ?? BARE.exec(before)
  const [, name, typed] = found ?? []
  if (name === undefined || typed === undefined) return null

  const field = FIELDS.find((one) => one === name.toLowerCase())
  if (!field) return null

  return { field, typed, from: caret - typed.length, to: caret, quoted: quoted !== null }
}

/** The operator name the caret is in the middle of, or null when what is there
 *  could not become one. */
export function naming(source: string, caret: number): Completing | null {
  const found = NAME.exec(source.slice(0, caret))
  const typed = found?.[1]
  if (typed === undefined) return null

  const folded = typed.toLowerCase()
  if (!OPERATORS.some((one) => one.startsWith(folded))) return null

  return { field: 'name', typed, from: caret - typed.length, to: caret, quoted: false }
}

/** How many values a popup is worth. Past this it is a file list, not a hint. */
const MOST = 12

/** The values worth offering, the ones that start with what was typed first,
 *  each list already in the order the space keeps it. */
export function offered(typed: string, values: readonly string[]): string[] {
  const needle = typed.trim().toLowerCase()
  if (!needle) return values.slice(0, MOST)

  const starts: string[] = []
  const holds: string[] = []

  for (const value of values) {
    const folded = value.toLowerCase()
    if (folded.startsWith(needle)) starts.push(value)
    else if (folded.includes(needle)) holds.push(value)
  }

  return [...starts, ...holds].slice(0, MOST)
}

/** The query with a chosen value in it, and where the caret lands: after the
 *  value, so the next operator can be typed straight on. A value with a space
 *  in it is quoted, because the grammar ends a bare value at the space. */
/** The values a half-typed one is nearest to, best first.
 *
 *  The same scorer the hit list ranks with, so a tag is found the way a line is:
 *  `wnc` offers `work/nib/canvas`, and a letter typed wrong still offers what was
 *  meant. Worth it for a tag and not for a note name because a tag path is long
 *  and deep, and typing one out to the end is what the tree is there to avoid. */
export function nearest(typed: string, values: readonly string[]): string[] {
  const needle = typed.trim()
  if (!needle) return values.slice(0, MOST)

  return values
    .flatMap((value) => {
      const found = fit(needle, value)
      return found ? [{ value, score: found.score }] : []
    })
    .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value))
    .slice(0, MOST)
    .map((one) => one.value)
}

export function chosen(
  source: string,
  at: Completing,
  value: string,
): { text: string; caret: number } {
  const written = !at.quoted && /\s/.test(value) ? `"${value}"` : value
  // A quote the reader typed themselves is closed for them, unless the closing
  // one is already sitting after the caret.
  const closed = source.charAt(at.to) === '"'
  const tail = at.quoted && !closed ? '"' : ''

  const text = source.slice(0, at.from) + written + tail + source.slice(at.to)
  const past = at.quoted && closed ? 1 : 0
  return { text, caret: at.from + written.length + tail.length + past }
}
