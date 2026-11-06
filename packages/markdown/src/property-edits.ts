import { oneEdit, type TextEdit } from './edits'
import { frontMatterBlock, frontMatterEdit, isPropertyName } from './front-matter'
import { type Property, type PropertyKind, keyCalled, readProperties } from './properties'
import { flowItem, scalar } from './yaml'

export type ListItem = string | number | boolean | null | KeptItem

export interface KeptItem {
  asWritten: string
  block?: true
}

export function writtenList(items: readonly ListItem[]): string {
  return `[${items.map(writtenItem).join(', ')}]`
}

function writtenItem(item: ListItem): string {
  if (item === null || typeof item === 'boolean') return String(item)
  if (typeof item === 'object') return item.asWritten
  if (typeof item === 'number') return Number.isFinite(item) ? String(item) : flowItem(String(item))
  return flowItem(item)
}

export function listItems(property: Property): ListItem[] {
  const quoted = property.quotedItems ?? []
  const written = property.writtenItems ?? []
  return property.items.map((item, at) => {
    if (quoted[at]) {
      const said = written[at]
      if (said === undefined) return item
      return ONLY_QUOTED.test(said) ? { asWritten: said } : { asWritten: said, block: true }
    }
    if (item === '') return null
    if (BLOCK_ONLY.test(item)) return { asWritten: item, block: true }
    if (/[,[\]{}]/.test(item)) return item
    return { asWritten: item }
  })
}

const ONLY_QUOTED = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')$/

const BLOCK_ONLY = /(?:^|\s)#|^-(?:\s|$)|^[?:](?:\s|$)|:(?:\s|$)|^[|>]/

export function listLines(key: string, items: readonly ListItem[], source = ''): string {
  const block = items.some((one) => one !== null && typeof one === 'object' && one.block)
  if (!block) return `${key}: ${writtenList(items)}`
  const ending = source.includes('\r\n') ? '\r\n' : '\n'
  return [`${key}:`, ...items.map((one) => `  - ${writtenItem(one)}`)].join(ending)
}

function written(value: string, kind: PropertyKind): string {
  if (kind === 'checkbox') return value.toLowerCase() === 'true' ? 'true' : 'false'
  if (kind === 'number' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return value.trim()
  return scalar(value)
}

export function writeProperty(
  source: string,
  key: string,
  value: string | null,
  kind: PropertyKind = 'text',
): TextEdit | null {
  return frontMatterEdit(source, key, value === null ? null : written(value, kind))
}

export function writeList(
  source: string,
  key: string,
  items: readonly ListItem[],
): TextEdit | null {
  const rows = readProperties(source)
  const found = rows && keyCalled(rows, key)
  if (!found) return frontMatterEdit(source, key, writtenList(items))

  const lines = listLines(found.key, items, source)
  const after = `${source.slice(0, found.from)}${lines}${source.slice(found.to)}`
  return oneEdit(source, after)
}

export function withItem(property: Property, item: string): ListItem[] | null {
  const said = item.trim()
  if (!said || property.items.includes(said)) return null
  return [...listItems(property), typedItem(said)]
}

export function typedItem(said: string): ListItem {
  if (said === 'true' || said === 'false') return said === 'true'
  if (/^-?\d+(?:\.\d+)?$/.test(said) && String(Number(said)) === said) return Number(said)
  return said
}

export function withoutItem(property: Property, item: string): ListItem[] | null {
  if (!property.items.includes(item)) return null
  const items = listItems(property)
  return items.filter((_, at) => property.items[at] !== item)
}

export function renameProperty(source: string, key: string, next: string): TextEdit | null {
  const name = next.trim()
  if (!isPropertyName(name) || name === key) return null

  const rows = readProperties(source) ?? []
  const found = rows.find((one) => one.key === key)
  const taken = rows.some((one) => one !== found && one.key.toLowerCase() === name.toLowerCase())
  if (!found || taken) return null

  return { from: found.from, to: found.from + key.length, insert: name }
}

export function propertyNamed(source: string, name: string): Property | null {
  const wanted = name.trim().toLowerCase()
  return readProperties(source)?.find((one) => one.key.toLowerCase() === wanted) ?? null
}

export function addProperty(source: string, name: string): TextEdit | null {
  const key = name.trim()
  if (!isPropertyName(key) || propertyNamed(source, key)) return null
  return writeProperty(source, key, '')
}

export function removeProperty(source: string, key: string): TextEdit | null {
  const found = readProperties(source)?.find((one) => one.key === key)
  if (!found) return null

  const past = source.startsWith('\r\n', found.to) ? found.to + 2 : found.to + 1
  const after = source.slice(0, found.from) + source.slice(Math.min(past, source.length))
  const block = frontMatterBlock(after)
  if (!block || after.slice(block.body.from, block.body.to).trim()) return oneEdit(source, after)

  return oneEdit(source, after.slice(block.to).replace(/^(?:\r?\n)+/, ''))
}
