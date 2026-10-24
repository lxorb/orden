/** What a property row's control writes back into the note.
 *
 *  A reader typing in a date field, ticking a checkbox or taking a tag off a list is
 *  changing their own metadata, and what has to come out the other side is plain
 *  front matter: `tags: [one, two]`, `done: true`, `due: 2026-09-14`. Nothing here
 *  invents a spelling of its own, and nothing here writes a shape `readProperties`
 *  next door could not read back - a row that wrote something the rows cannot read
 *  would turn the whole block into source the moment it was written.
 *
 *  Built on `frontMatterEdit`, which is the one thing in this package that knows how
 *  to change a key without disturbing the rest of the block. A list is the one shape
 *  that edit cannot do on its own, because a list may be several lines and that
 *  function thinks in single-line scalars; a list's own span is what
 *  `readProperties` already reports, so writing one is replacing that span.
 *
 *  Every answer is one `TextEdit`, so one gesture is one thing to undo. Null where
 *  the note already says it, so a control that was pressed and put back writes no
 *  file at all. */

import { oneEdit, type TextEdit } from './edits'
import { frontMatterBlock, frontMatterEdit } from './front-matter'
import { type Property, type PropertyKind, keyCalled, readProperties } from './properties'
import { flowItem, scalar } from './yaml'

/** One item of a list as what it means: words, a number, a yes or no, or nothing.
 *  A list is not only tags; `scores: [1, 2, 10]` holds numbers, and a list rewritten
 *  as strings would have every base that reads it sort `10` before `2`. */
export type ListItem = string | number | boolean | null | KeptItem

/** A member a rewrite leaves alone, as the note wrote it: put back character for
 *  character, so `1.10`, `007` and `1234567890123456789` are not read as numbers and
 *  written again as `1.1`, `7` and `1234567890123456800`, and `"a"` keeps its quotes. */
export interface KeptItem {
  asWritten: string
  /** Set where the member as written means itself only in a block list: one with a
   *  comment after it, a list or a map of its own. A list holding one is written back
   *  as a block list, since in a flow one the comment would close the list early and
   *  the rest would be words. */
  block?: true
}

/** A list as a note writes one: a flow sequence, which is what Obsidian writes and
 *  what `frontMatterList` reads back. `[]` for a list with nothing in it, because a
 *  key with an empty list is still a fact about the note.
 *
 *  A number, a yes or no and nothing are written bare, which is what makes them
 *  those things to YAML. Words go through `flowItem`, which quotes the ones YAML
 *  would read as something else, so the word `true` comes back as the word. */
export function writtenList(items: readonly ListItem[]): string {
  return `[${items.map(writtenItem).join(', ')}]`
}

function writtenItem(item: ListItem): string {
  if (item === null || typeof item === 'boolean') return String(item)
  if (typeof item === 'object') return item.asWritten
  if (typeof item === 'number') return Number.isFinite(item) ? String(item) : flowItem(String(item))
  return flowItem(item)
}

/** A list row's items as the note wrote them. This is what a chip edit writes back
 *  for the members it did not touch, so taking `2` off `[1, 2, 10]` leaves `[1, 10]`
 *  rather than `['1', '10']`, and taking `5` off `[1.10, 5, 007]` leaves `[1.10, 007]`
 *  rather than the numbers those read as.
 *
 *  A block list is written back as a flow one, where a plain member holding a comma
 *  or a bracket would be cut into several; that one alone is quoted, which is the
 *  same words to YAML. */
export function listItems(property: Property): ListItem[] {
  const quoted = property.quotedItems ?? []
  const written = property.writtenItems ?? []
  return property.items.map((item, at) => {
    if (quoted[at]) return { asWritten: written[at] ?? flowItem(item) }
    // `-` with nothing after it is a member that is nothing, which a flow list has to
    // say: `[, b]` is not YAML.
    if (item === '') return null
    if (BLOCK_ONLY.test(item)) return { asWritten: item, block: true }
    if (/[,[\]{}]/.test(item)) return item
    return { asWritten: item }
  })
}

/** A plain member that means what it says only as a line of a block list: a comment
 *  after it, a list of its own (`- - x`), a map (`- a: b`) or a block scalar. */
const BLOCK_ONLY = /(?:^|\s)#|^-(?:\s|$)|^[?:](?:\s|$)|:(?:\s|$)|^[|>]/

/** A key and its list as the lines a note writes them: a flow list on the key's line,
 *  or, where a member means itself only in a block list, a `- ` line for each. */
export function listLines(key: string, items: readonly ListItem[]): string {
  const block = items.some((one) => one !== null && typeof one === 'object' && one.block)
  if (!block) return `${key}: ${writtenList(items)}`
  return [`${key}:`, ...items.map((one) => `  - ${writtenItem(one)}`)].join('\n')
}

/** How a value is written for each kind of control.
 *
 *  A checkbox and a number mean the bare word and the bare digits: `done: true` is
 *  the thing a checkbox is, and `done: 'true'` would be a note saying its own
 *  checkbox is a piece of text. Everything else goes through `scalar`, which quotes
 *  whatever YAML would read as something other than the words it says - so a title
 *  somebody typed the word `true` into comes back as the word.
 *
 *  A number field that somehow holds something that is not a number falls back to
 *  the same quoting: the file says what was typed, and the row it comes back as is
 *  whatever that reads as. Nothing here writes a value the rows cannot read. */
function written(value: string, kind: PropertyKind): string {
  if (kind === 'checkbox') return value.toLowerCase() === 'true' ? 'true' : 'false'
  if (kind === 'number' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return value.trim()
  return scalar(value)
}

/** One edit that sets a top-level key to a scalar, or takes the key away when the
 *  value is null. `kind` is the control the value came out of, which is what decides
 *  whether it is written bare or quoted. */
export function writeProperty(
  source: string,
  key: string,
  value: string | null,
  kind: PropertyKind = 'text',
): TextEdit | null {
  return frontMatterEdit(source, key, value === null ? null : written(value, kind))
}

/** One edit that sets a top-level key to a list.
 *
 *  The property's own span is replaced, which is what makes a list written over
 *  several lines come back as one: `readProperties` reports a key's line through to
 *  the last of its items, so a `- item` list of four lines and a `[a, b]` of one are
 *  the same span to replace.
 *
 *  A key the block does not hold yet is appended the way any other key is. */
export function writeList(
  source: string,
  key: string,
  items: readonly ListItem[],
): TextEdit | null {
  const rows = readProperties(source)
  const found = rows && keyCalled(rows, key)
  if (!found) return frontMatterEdit(source, key, writtenList(items))

  // In the note's own spelling of the key, which may be another case than asked.
  const lines = listLines(found.key, items)
  const after = `${source.slice(0, found.from)}${lines}${source.slice(found.to)}`
  return oneEdit(source, after)
}

/** The same list with `item` on the end, or unchanged where it is already in it. A
 *  list is a set of names and the same name twice says nothing twice. */
export function withItem(property: Property, item: string): ListItem[] | null {
  const said = item.trim()
  if (!said || property.items.includes(said)) return null
  return [...listItems(property), typedItem(said)]
}

/** A chip somebody typed, as what they would have meant typing it bare into the
 *  note: `3` is the number and `true` the yes, so a chip added to `scores: [1, 10]`
 *  sums with the others. Only where YAML reads the bare text back as that same
 *  text, though - `007` would come back as 7, `1e3` as a thousand and `yes` or
 *  `True` as a yes spelled differently - and those stay the words, which
 *  `flowItem` quotes. */
export function typedItem(said: string): ListItem {
  if (said === 'true' || said === 'false') return said === 'true'
  if (/^-?\d+(?:\.\d+)?$/.test(said) && String(Number(said)) === said) return Number(said)
  return said
}

/** The same list with `item` gone. Null where it was not in it, which is a chip
 *  pressed twice before the document caught up. */
export function withoutItem(property: Property, item: string): ListItem[] | null {
  if (!property.items.includes(item)) return null
  const items = listItems(property)
  return items.filter((_, at) => property.items[at] !== item)
}

/** What a key may be called: the shape `readProperties` reads a key by. */
const KEY_NAME = /^[A-Za-z_][\w-]*$/

/** One edit that renames a key and touches nothing else: its value, its place and
 *  every other line of the block stay byte for byte. Null for a name that is not a
 *  key, the same name, or a name another key of the block already has - two keys
 *  of one name is a block YAML reads as the last of them. */
export function renameProperty(source: string, key: string, next: string): TextEdit | null {
  const name = next.trim()
  if (!KEY_NAME.test(name) || name === key) return null

  const rows = readProperties(source) ?? []
  const found = rows.find((one) => one.key === key)
  const taken = rows.some((one) => one !== found && one.key.toLowerCase() === name.toLowerCase())
  if (!found || taken) return null

  return { from: found.from, to: found.from + key.length, insert: name }
}

/** One edit that takes a key away with everything written under it: a list's
 *  `- item` lines go with the key rather than being left behind as a shape nothing
 *  reads. A block left with nothing in it goes too, with the blank lines under it,
 *  as `frontMatterEdit` does for a single line. */
export function removeProperty(source: string, key: string): TextEdit | null {
  const found = readProperties(source)?.find((one) => one.key === key)
  if (!found) return null

  const past = source.startsWith('\r\n', found.to) ? found.to + 2 : found.to + 1
  const after = source.slice(0, found.from) + source.slice(Math.min(past, source.length))
  const block = frontMatterBlock(after)
  if (!block || after.slice(block.body.from, block.body.to).trim()) return oneEdit(source, after)

  return oneEdit(source, after.slice(block.to).replace(/^(?:\r?\n)+/, ''))
}
