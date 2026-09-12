/** The little of YAML a note's metadata actually holds.
 *
 *  Three readers in this package take values out of a `key: value` block: the
 *  front matter reader, the properties reader that draws that block as rows, and
 *  the chart reader, whose fences are written the same way. Each carried its own
 *  copy of "take the quotes off" and "is this a `[a, b]` list", and the copies had
 *  drifted: one read a list at the key's own margin and another did not, so the
 *  same note drew rows in one place and raw source in the other.
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
