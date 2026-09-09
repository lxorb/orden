/** A note's front matter, read as the handful of things it usually says.
 *
 *  The block is YAML, and nothing here is a YAML parser. What it reads is what a
 *  note written by hand, by nib or by Obsidian actually holds: a top-level key on
 *  a line, and after the colon a word, a number, a date, a yes or no, a list
 *  written either of the two ways, or the pairs of a small map - which is the
 *  shape nib's own `export:` page setup uses.
 *
 *  The rule for everything else is the important one: **if any line of the block
 *  is a shape this does not know, the whole block is left as source.** Not a
 *  table with one row missing, and not a row saying it could not read itself - a
 *  half-drawn table is a table that lies about what is in the file. Somebody
 *  whose front matter holds a Dataview query gets their YAML, which is always
 *  right, and everybody else gets rows.
 *
 *  Nothing here writes. The rows are what the block says, and the way to change
 *  one is the way to change anything else in a note: put the caret in it and
 *  type. `frontMatterEdit` next door is for the app setting a key of its own -
 *  an icon, a title - which is a different thing from a reader editing their own
 *  metadata. */

import { frontMatterBlock } from './front-matter'
import { escape } from './html'

/** What a value looks like it is, which decides what it is drawn as. */
export type PropertyKind = 'text' | 'list' | 'number' | 'date' | 'checkbox' | 'map'

export interface Property {
  key: string
  kind: PropertyKind
  /** The value as written, quotes off. Empty for a list, and for a key with
   *  nothing after its colon. */
  value: string
  /** A list's items. Empty for everything else. */
  items: string[]
  /** Where the key's own line sits in the note, so a click can put the caret on
   *  it rather than somewhere near it. */
  from: number
  to: number
}

/** A top-level `key:`. Indented lines belong to the key above them, and a line
 *  that is only a value is part of a list. */
const KEY = /^([A-Za-z_][\w-]*)[ \t]*:(.*)$/

/** A `- item` line, however far it is indented. */
const ITEM = /^[ \t]+-[ \t]*(.*)$/

/** A `key: value` line indented under another key: the shape `export:` uses to
 *  say what paper a note prints on. */
const NESTED = /^[ \t]+([A-Za-z_][\w-]*)[ \t]*:[ \t]*(.*)$/

/** Quotes around a whole value, which YAML reads as one string. */
const QUOTED = /^(["'])([\s\S]*)\1$/

/** A flow sequence: `[a, b, c]`, and `[]` for a list of nothing. */
const FLOW = /^\[([\s\S]*)\]$/

/** `true` and `false`, which is how Obsidian writes a checkbox. YAML 1.1 also
 *  reads `yes` and `no` as booleans, and this deliberately does not: a note whose
 *  `status: no` became a cleared checkbox would be a note lied to about itself. */
const YES_NO = /^(true|false)$/i

/** A number, as YAML writes one. */
const NUMBER = /^-?\d+(?:\.\d+)?$/

/** A date, and a date with a time after it. Not a full ISO parse: what this has
 *  to tell apart is a date from a word, and `2025-09-08` is not a word. */
const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/

/** Well past any note's metadata, and a ceiling so a file that opens with a
 *  thousand lines between two fences is left as the source it is. */
const MOST_KEYS = 64

function unquoted(value: string): string {
  return QUOTED.exec(value)?.[2] ?? value
}

/** What a value on the line is. */
function kindOf(value: string): PropertyKind {
  if (YES_NO.test(value)) return 'checkbox'
  if (NUMBER.test(value)) return 'number'
  if (DATE.test(value)) return 'date'
  return 'text'
}

/** The items of a flow sequence, or null when the value is not one. */
function flow(value: string): string[] | null {
  const found = FLOW.exec(value)
  if (!found) return null

  const inside = (found[1] ?? '').trim()
  return inside === '' ? [] : inside.split(',').map((one) => unquoted(one.trim()))
}

/** Every line of the block, with where each one sits. */
function linesOf(
  source: string,
  from: number,
  to: number,
): { text: string; from: number; to: number }[] {
  const out: { text: string; from: number; to: number }[] = []
  let at = from

  while (at < to) {
    const end = source.indexOf('\n', at)
    const stop = end === -1 || end > to ? to : end
    out.push({ text: source.slice(at, stop).replace(/\r$/, ''), from: at, to: stop })
    if (end === -1) break
    at = end + 1
  }

  return out
}

/** The note's front matter as rows, or null when there is none to read - either
 *  because the note has no block, or because the block says something this
 *  cannot draw without guessing. Both answers mean the same thing to a caller:
 *  show the source. */
export function readProperties(source: string): Property[] | null {
  const block = frontMatterBlock(source)
  if (!block) return null

  const lines = linesOf(source, block.body.from, block.body.to)
  const out: Property[] = []

  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]
    if (!line || line.text.trim() === '') continue

    // A comment is not a row, and a block that carries one is a block somebody
    // is keeping notes in. Left as source rather than silently dropped.
    if (line.text.trimStart().startsWith('#')) return null

    const found = KEY.exec(line.text)
    if (!found) return null

    const key = found[1] ?? ''
    const written = (found[2] ?? '').trim()
    const listed = flow(written)

    if (listed !== null) {
      out.push({ key, kind: 'list', value: '', items: listed, from: line.from, to: line.to })
      continue
    }

    if (written) {
      const value = unquoted(written)
      out.push({ key, kind: kindOf(value), value, items: [], from: line.from, to: line.to })
      continue
    }

    // Nothing after the colon: what is indented under it. Either `- item` lines,
    // which are a list, or `key: value` lines, which are a map - `export:` with
    // a paper size under it is nib's own, and a note that uses it should still
    // get rows. Anything else indented is a shape nobody here can name, and the
    // block goes back to being source.
    const items: string[] = []
    let mapped = false
    let last = line.to

    while (at + 1 < lines.length) {
      const next = lines[at + 1]
      if (!next) break
      if (next.text.trim() === '') break
      if (!next.text.startsWith(' ') && !next.text.startsWith('\t')) break

      const item = ITEM.exec(next.text)
      const pair = item === null ? NESTED.exec(next.text) : null
      if (!item && !pair) return null
      // One or the other, never both: a key with a list and a map under it is
      // not something YAML means either.
      if (item && mapped) return null
      if (pair && items.length && !mapped) return null

      if (item) items.push(unquoted((item[1] ?? '').trim()))
      else {
        mapped = true
        items.push(`${pair?.[1] ?? ''}: ${unquoted((pair?.[2] ?? '').trim())}`.trim())
      }

      last = next.to
      at++
    }

    out.push({
      key,
      kind: mapped ? 'map' : items.length ? 'list' : 'text',
      value: '',
      items,
      from: line.from,
      to: last,
    })

    if (out.length > MOST_KEYS) return null
  }

  return out
}

/** The rows as markup, for the editor's block and for the reading view, so the
 *  two are one drawing rather than two that look alike.
 *
 *  Every row carries where its line sits, which is what lets a click in the
 *  editor put the caret on the line the row was drawn from. */
export function propertiesTable(properties: readonly Property[]): string {
  const rows = properties.map((one) => row(one)).join('')
  return `<div class="properties" role="table">${rows}</div>`
}

function row(property: Property): string {
  return (
    `<div class="property nib-row is-short" role="row"` +
    ` data-key="${escape(property.key)}" data-from="${property.from}" data-to="${property.to}">` +
    `<span class="property-key nib-row-label" role="rowheader">${escape(property.key)}</span>` +
    `<span class="property-value" role="cell">${value(property)}</span>` +
    `</div>`
  )
}

function value(property: Property): string {
  if (property.kind === 'list' || property.kind === 'map') {
    // A list of nothing still says the key is there and empty, which is a fact
    // about the note rather than a gap.
    return property.items.map((one) => `<span class="property-chip">${escape(one)}</span>`).join('')
  }

  if (property.kind === 'checkbox') {
    const on = property.value.toLowerCase() === 'true'
    return `<span class="property-check${on ? ' is-on' : ''}" role="img" aria-label="${on ? 'true' : 'false'}"></span>`
  }

  if (property.value === '') return '<span class="property-empty"></span>'

  return `<span class="property-said" data-kind="${property.kind}">${escape(property.value)}</span>`
}
