import { frontMatterBlock } from '@orden/markdown/front-matter'
import { type Property, readProperties } from '@orden/markdown/properties'
import { isScalar, isSeq, parse, parseDocument, type Scalar, visit } from 'yaml'
import type { Value } from './types'

const WIKILINK = /^!?\[\[([^\]|#]*(?:#[^\]|]*)?)(?:\|([^\]]*))?\]\]$/

const DATE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/

export function scalarValue(written: string): Value {
  const text = written.trim()
  if (text === '' || text === 'null' || text === '~') return null
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true'
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text)
  return stringValue(text)
}

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

function readValue(text: string, quoted: boolean | undefined): Value {
  return quoted ? stringValue(text) : scalarValue(text)
}

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

export function noteValues(text: string): Record<string, Value> {
  const source = text.startsWith('---')
    ? text
    : `---\n${text}${text.endsWith('\n') ? '' : '\n'}---\n`
  const rows = readProperties(source)
  if (rows) {
    const firsts = new Map<string, Value>()
    for (const row of rows) if (!firsts.has(row.key)) firsts.set(row.key, propertyValue(row))
    return Object.fromEntries(firsts)
  }

  const block = frontMatterBlock(source)
  if (!block) return {}
  try {
    const read: unknown = parse(source.slice(block.body.from, block.body.to), { schema: 'core' })
    if (read === null || typeof read !== 'object' || Array.isArray(read)) return {}
    return Object.fromEntries(Object.entries(read).map(([key, value]) => [key, fromYaml(value)]))
  } catch {
    try {
      const kept = source
        .slice(block.body.from, block.body.to)
        .split('\n')
        .filter((line) => !/^[^\s#-]/.test(line) || /:(?:\s|$)/.test(line))
        .join('\n')
      const read: unknown = parse(kept, { schema: 'core' })
      if (read === null || typeof read !== 'object' || Array.isArray(read)) return {}
      return Object.fromEntries(Object.entries(read).map(([key, value]) => [key, fromYaml(value)]))
    } catch {
      return {}
    }
  }
}

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
  const read = whole === null ? {} : (whole as Record<string, unknown>)
  const spelled =
    key in read
      ? key
      : (Object.keys(read).find((one) => one.toLowerCase() === key.toLowerCase()) ?? key)
  const held = read[spelled]

  const lines = body.split('\n')
  const opens = new RegExp(`^${spelled.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*:`)
  const starts = lines.flatMap((line, at) => (opens.test(line) ? [at] : []))
  if (starts.length === 0) return held === undefined ? 'absent' : null
  if (starts.length > 1) return null
  const first = starts[0] ?? 0
  let last = first
  while (last + 1 < lines.length) {
    const next = lines[last + 1] ?? ''
    if (!/^[ \t]/.test(next) && !/^-(?:[ \t\r]|$)/.test(next)) break
    last++
  }
  const from = block.body.from + lines.slice(0, first).reduce((sum, one) => sum + one.length + 1, 0)
  const own = lines.slice(first, last + 1)
  const to = from + own.join('\n').replace(/\r$/, '').length
  const span = own.map((line) => line.replace(/\r$/, '')).join('\n')

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
