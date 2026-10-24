/** A note's front matter as values, and a task's words as the hash its anchor
 *  carries: the two things the rows store asks of the engine for every file it
 *  reads.
 *
 *  The front matter is read the cheap way first, by the properties reader the
 *  Properties panel already uses (`@nib/markdown/properties`), which is a regex
 *  per line. Only a block that reader will not draw (a comment in it, a nested
 *  list, a shape it cannot name) is handed to a real YAML parser, so five thousand
 *  ordinary notes cost five thousand small regex passes and the odd note still
 *  gets its values. */

import { frontMatterBlock } from '@nib/markdown/front-matter'
import { type Property, readProperties } from '@nib/markdown/properties'
import { isScalar, isSeq, parse, parseDocument, type Scalar, visit } from 'yaml'
import type { Value } from './types'

/** `[[target]]`, `[[target|display]]`, `![[target]]`, as a property holds one. */
const WIKILINK = /^!?\[\[([^\]|#]*(?:#[^\]|]*)?)(?:\|([^\]]*))?\]\]$/

/** A date, a date with a time, as YAML and Obsidian write them. */
const DATE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/

/** A scalar written in front matter, as the value it means. Written plain, that is:
 *  a value that was in quotes is `stringValue`'s, because the quotes are YAML saying
 *  "these characters", and `'007'` read as the number seven is a zip code lost. */
export function scalarValue(written: string): Value {
  const text = written.trim()
  if (text === '' || text === 'null' || text === '~') return null
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true'
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text)
  return stringValue(text)
}

/** A string as the value it means: never nothing, a box or a number, which only a
 *  plain scalar can be, but still a link or a date, because those are strings to
 *  YAML too and Obsidian writes a link in quotes as often as not. */
function stringValue(written: string): Value {
  const text = written.trim()
  const link = WIKILINK.exec(text)
  if (link) {
    const target = (link[1] ?? '').trim()
    return link[2] === undefined
      ? { kind: 'link', target }
      : { kind: 'link', target, display: link[2] }
  }

  const date = DATE.exec(text)
  if (date?.[1]) {
    const value: Value = { kind: 'date', iso: date[1] }
    if (date[2]) value.time = date[2]
    if (date[3]) value.zone = date[3] === 'Z' ? 'UTC' : date[3]
    return value
  }
  return text
}

/** A value the reader handed back with its quotes off, read the way its quotes say. */
function readValue(text: string, quoted: boolean | undefined): Value {
  return quoted ? stringValue(text) : scalarValue(text)
}

/** A row of the properties reader as a value. */
function propertyValue(property: Property): Value {
  const quoted = property.quotedItems ?? []
  switch (property.kind) {
    case 'list':
      return property.items.map((item, at) => readValue(item, quoted[at]))
    case 'map':
      return Object.fromEntries(
        property.items.map((item, at) => {
          const colon = item.indexOf(':')
          return [item.slice(0, colon).trim(), readValue(item.slice(colon + 1), quoted[at])]
        }),
      )
    case 'text':
    case 'number':
    case 'date':
    case 'checkbox':
      return readValue(property.value, property.quoted)
  }
}

/** What a YAML parser answered, as values: strings read the way a quoted scalar is,
 *  so a link and a date mean the same whichever reader met them. Not as a plain one:
 *  the parser has already made every plain `7`, `true` and `null` what it means, so
 *  a string that still says one of them was written in quotes to stay a string. */
function fromYaml(read: unknown): Value {
  if (read === null || read === undefined) return null
  if (typeof read === 'string') return stringValue(read)
  if (typeof read === 'number' || typeof read === 'boolean') return read
  if (Array.isArray(read)) return read.map(fromYaml)
  if (typeof read === 'object') {
    return Object.fromEntries(Object.entries(read).map(([key, value]) => [key, fromYaml(value)]))
  }
  return null
}

/** A note's front matter as values by key, or nothing for a note without any or
 *  with a block that is not YAML. Takes the note, or the block's lines alone
 *  without their fences, which is what the scan carries. */
export function noteValues(text: string): Record<string, Value> {
  const source = text.startsWith('---')
    ? text
    : `---\n${text}${text.endsWith('\n') ? '' : '\n'}---\n`
  const rows = readProperties(source)
  if (rows) return Object.fromEntries(rows.map((row) => [row.key, propertyValue(row)]))

  const block = frontMatterBlock(source)
  if (!block) return {}
  try {
    // The core schema reads a timestamp as the string it is written as, which the
    // scalar reader then takes for a date the way the fast path does.
    const read: unknown = parse(source.slice(block.body.from, block.body.to), { schema: 'core' })
    if (read === null || typeof read !== 'object' || Array.isArray(read)) return {}
    return Object.fromEntries(Object.entries(read).map(([key, value]) => [key, fromYaml(value)]))
  } catch {
    // A block that is not YAML holds no values; the note is still a row.
    return {}
  }
}

/** Where a key's list sits in a block the properties reader will not draw (a comment
 *  line, a block scalar), with its members as written, read by YAML: what a chip put on
 *  or taken off such a list is applied to, so the members the cell showed are the ones
 *  written back. `absent` for a block that reads as YAML and holds no such key, and
 *  null wherever the list cannot be rewritten without losing something the block says:
 *  a block that is not YAML, the key twice, a comment among the members, a member that
 *  is not a single value, or a span that does not hold every member YAML reads there.
 *
 *  `from` and `to` are the key's own lines in `text`, so a rewrite replaces those and
 *  nothing else. A single value is a list of one, and a key with nothing a list of
 *  none. */
export function listAsWritten(
  text: string,
  key: string,
): 'absent' | { from: number; to: number; property: Property } | null {
  const block = frontMatterBlock(text)
  if (!block) return 'absent'
  const body = text.slice(block.body.from, block.body.to)

  let whole: unknown
  try {
    whole = parse(body, { schema: 'core' })
  } catch {
    return null
  }
  if (whole !== null && (typeof whole !== 'object' || Array.isArray(whole))) return null
  // The key in the note's own spelling, found the way `frontMatterEdit` finds it: in
  // the case asked for where the note has it, else the first in another.
  const read = whole === null ? {} : (whole as Record<string, unknown>)
  const spelled =
    key in read
      ? key
      : (Object.keys(read).find((one) => one.toLowerCase() === key.toLowerCase()) ?? key)
  const held = read[spelled]

  // The key's own lines: its line, and every line after it that is indented under it
  // or is one of its `- ` items, which YAML lets sit at the key's own margin.
  const lines = body.split('\n')
  const opens = new RegExp(`^${spelled.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*:`)
  const starts = lines.flatMap((line, at) => (opens.test(line) ? [at] : []))
  if (starts.length === 0) return held === undefined ? 'absent' : null
  if (starts.length > 1) return null
  const first = starts[0] ?? 0
  let last = first
  while (last + 1 < lines.length) {
    const next = lines[last + 1] ?? ''
    if (!/^[ \t]/.test(next) && !/^-(?:[ \t]|$)/.test(next)) break
    last++
  }
  const from = block.body.from + lines.slice(0, first).reduce((sum, one) => sum + one.length + 1, 0)
  const span = lines.slice(first, last + 1).join('\n')
  const to = from + span.length

  let doc
  try {
    doc = parseDocument(span, { schema: 'core' })
  } catch {
    return null
  }
  if (doc.errors.length) return null
  let commented = Boolean(doc.comment) || Boolean(doc.commentBefore)
  visit(doc, (_, node) => {
    if (node && typeof node === 'object' && ('comment' in node || 'commentBefore' in node)) {
      const said = node as { comment?: string | null; commentBefore?: string | null }
      if (said.comment || said.commentBefore) commented = true
    }
  })
  if (commented) return null

  const pair = doc.contents && 'items' in doc.contents ? doc.contents.items[0] : undefined
  const value = pair && typeof pair === 'object' && 'value' in pair ? pair.value : undefined
  const nodes = isSeq(value) ? value.items : isScalar(value) && value.value !== null ? [value] : []
  if (value !== null && value !== undefined && !isSeq(value) && !isScalar(value)) return null

  const items: string[] = []
  const written: string[] = []
  const quoted: boolean[] = []
  for (const node of nodes) {
    if (!isScalar(node) || !node.range) return null
    if (node.type !== 'PLAIN' && node.type !== 'QUOTE_DOUBLE' && node.type !== 'QUOTE_SINGLE')
      return null
    const said = span.slice(node.range[0], node.range[1])
    const inQuotes = node.type !== 'PLAIN'
    items.push(inQuotes ? String(node.value) : said)
    written.push(said)
    quoted.push(inQuotes)
  }

  // Every member YAML reads under the key is in the span, or the rewrite would leave
  // the rest behind as lines of their own.
  const members: unknown = isSeq(value) ? value.toJSON() : nodes.map((one) => (one as Scalar).value)
  const expected = held === undefined || held === null ? [] : Array.isArray(held) ? held : [held]
  if (JSON.stringify(members) !== JSON.stringify(expected)) return null

  const property: Property = {
    key: spelled,
    kind: 'list',
    value: '',
    items,
    ...(quoted.includes(true) ? { quotedItems: quoted, writtenItems: written } : {}),
    from,
    to,
  }
  return { from, to, property }
}

export { taskHash } from './task-hash'
