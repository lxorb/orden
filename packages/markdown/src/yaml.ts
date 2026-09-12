/** The little of YAML a note's metadata actually holds, read and written.
 *
 *  Three readers in this package take values out of a `key: value` block: the
 *  front matter reader, the properties reader that draws that block as rows, and
 *  the chart reader, whose fences are written the same way. Each carried its own
 *  copy of "take the quotes off" and "is this a `[a, b]` list", and the copies had
 *  drifted: one read a list at the key's own margin and another did not, so the
 *  same note drew rows in one place and raw source in the other.
 *
 *  The writing is here for the same reason, and it is aimed at the reading above
 *  it: an import and a clipped page both write a block, and each had quoted values
 *  its own way. One wrote `'It''s'`, which is YAML and which `unquoted` hands back
 *  with the doubling still in it; the other wrote `"say \"hi\""`, which is YAML and
 *  which comes back with the backslashes. So the quotes here are chosen by what is
 *  in the value: none where none are needed, single where the value has no
 *  apostrophe of its own, and double - escaped the way JSON escapes - only where it
 *  has. What is written then reads back as what was written, both here and in
 *  Obsidian.
 *
 *  None of this is a YAML parser, and none of it should become one. What it reads
 *  is what a note written by hand or by Obsidian holds. */

/** Quotes around a whole value, which YAML reads as one string. */
const QUOTED = /^(["'])([\s\S]*)\1$/

/** A value with the quotes YAML would take off taken off, and the blanks around
 *  it gone. */
export function unquoted(value: string): string {
  const trimmed = value.trim()
  return QUOTED.exec(trimmed)?.[2] ?? trimmed
}

/** A flow sequence: `[a, b, c]`, and `[]` for a list of nothing. */
const FLOW = /^\[([\s\S]*)\]$/

/** The items of a flow sequence, or null when the value is not one. */
export function flowItems(value: string): string[] | null {
  const found = FLOW.exec(value.trim())
  if (!found) return null

  const inside = (found[1] ?? '').trim()
  return inside === '' ? [] : inside.split(',').map(unquoted)
}

/** A `- item` line, however far it is indented: YAML lets the list under a key
 *  sit at the key's own margin as well as under it. The dash needs a blank after
 *  it, or it is part of the word - `-One` is the value `-One`, not an item. */
const ITEM = /^[ \t]*-(?=[ \t]|$)[ \t]*(.*)$/

/** What a list item on the line says, or null when the line is not one. */
export function listItem(line: string): string | null {
  const found = ITEM.exec(line)
  return found === null ? null : unquoted(found[1] ?? '')
}

/** One line, however many arrived.
 *
 *  A value in a block comes from somewhere else - a page's `og:title`, a column of
 *  another app's database - and such a place may put anything at all in it. A line
 *  break would end the block early, and everything after it would land in the note
 *  as markdown of that page's choosing; `---` on a line of its own is exactly the
 *  terminator. So no value in a block is ever more than a line, which is also what
 *  lets the writing below think in single-line scalars. */
export function oneLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

/** What YAML reads as something other than the string it says: nothing at all, a
 *  character that opens a construct where a value begins, a mapping or a comment
 *  opening inside it, a word that is a boolean or a null, or a number. */
function ambiguous(value: string): boolean {
  return (
    !value ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) ||
    /:\s|:$|\s#/.test(value) ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(value) ||
    /^[-+]?[\d.]+$/.test(value)
  )
}

/** A quoted value, in whichever quotes leave it readable: single, which need no
 *  escapes at all, unless the value carries an apostrophe. */
function quoted(value: string): string {
  return value.includes("'") ? JSON.stringify(value) : `'${value}'`
}

/** A value as a YAML scalar: plain where that reads back as itself, quoted where
 *  it would not. Plain wherever it can be, because a block whose every value is in
 *  quotes looks like something a machine made. */
export function scalar(value: string): string {
  const said = oneLine(value)
  return ambiguous(said) ? quoted(said) : said
}

/** A member of a flow sequence, which is how a note writes `tags:`. A scalar's
 *  rules, plus the characters that would end the member or the list itself. */
export function flowItem(value: string): string {
  const said = oneLine(value)
  return /[,[\]{}]/.test(said) ? quoted(said) : scalar(said)
}
