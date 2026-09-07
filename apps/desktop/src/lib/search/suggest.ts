/** Finishing an operator's value from what the space actually holds.
 *
 *  `path:` offers the folders, `file:` the notes, `tag:` the tags. Only the
 *  value: the operator itself is short enough to type, and a list of three
 *  words is a lesson, not a help. */

type Field = 'path' | 'file' | 'tag'

/** The value being typed: which operator it belongs to and where it sits, so
 *  the chosen one goes back exactly where the typed one was. */
export interface Completing {
  field: Field
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
