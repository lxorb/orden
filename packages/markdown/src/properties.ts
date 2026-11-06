import { frontMatterBlock, isPropertyName } from './front-matter'
import { escape } from './html'
import { isQuoted, uncommented, unquoted, writtenFlowItems, writtenListItem } from './yaml'

export type PropertiesMode = 'properties' | 'source' | 'hidden'

export const PROPERTIES_MODES: readonly PropertiesMode[] = ['properties', 'source', 'hidden']

export function propertiesMode(value: unknown): PropertiesMode {
  return PROPERTIES_MODES.find((one) => one === value) ?? 'hidden'
}

export type PropertyKind = 'text' | 'list' | 'number' | 'date' | 'checkbox' | 'map'

export interface Property {
  key: string
  kind: PropertyKind
  value: string
  items: string[]
  quoted?: true
  quotedItems?: boolean[]
  writtenItems?: string[]
  from: number
  to: number
}

const KEY = /^([^\s#-].*?)[ \t]*:(?=[ \t]|$)(.*)$/

const NESTED = /^[ \t]+([^\s#-].*?)[ \t]*:(?=[ \t]|$)[ \t]*(.*)$/

function keyed(pattern: RegExp, text: string): RegExpExecArray | null {
  const found = pattern.exec(text)
  return found && isPropertyName(found[1] ?? '') ? found : null
}

const YES_NO = /^(true|false)$/i

const NUMBER = /^-?\d+(?:\.\d+)?$/

const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/

const MOST_KEYS = 64

function kindOf(value: string, quoted: boolean): PropertyKind {
  if (quoted) return DATE.test(value) ? 'date' : 'text'
  if (YES_NO.test(value)) return 'checkbox'
  if (NUMBER.test(value)) return 'number'
  if (DATE.test(value)) return 'date'
  return 'text'
}

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
    const text = source.slice(at, stop).replace(/\r$/, '')
    out.push({ text, from: at, to: at + text.length })
    if (end === -1) break
    at = end + 1
  }

  return out
}

export function readProperties(source: string): Property[] | null {
  const block = frontMatterBlock(source)
  if (!block) return null

  const lines = linesOf(source, block.body.from, block.body.to)
  const out: Property[] = []

  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]
    if (!line || line.text.trim() === '') continue

    if (line.text.trimStart().startsWith('#')) return null

    const found = keyed(KEY, line.text)
    if (!found) return null

    if (out.length >= MOST_KEYS) return null

    const key = found[1] ?? ''
    const written = (found[2] ?? '').trim()
    if (uncommented(written) !== written) return null
    const listed = writtenFlowItems(written)

    if (listed !== null) {
      out.push({
        key,
        kind: 'list',
        value: '',
        items: listed.map(unquoted),
        ...quotes(listed, true),
        from: line.from,
        to: line.to,
      })
      continue
    }

    if (written) {
      const value = unquoted(written)
      const quoted = isQuoted(written)
      out.push({
        key,
        kind: kindOf(value, quoted),
        value,
        items: [],
        ...(quoted ? { quoted } : {}),
        from: line.from,
        to: line.to,
      })
      continue
    }

    const items: string[] = []
    const writtenItems: string[] = []
    let mapped = false
    let last = line.to

    while (at + 1 < lines.length) {
      const next = lines[at + 1]
      if (!next) break
      if (next.text.trim() === '') break

      const item = writtenListItem(next.text)
      const indented = next.text.startsWith(' ') || next.text.startsWith('\t')
      if (item === null && !indented) break

      const pair = item === null ? keyed(NESTED, next.text) : null
      if (item === null && !pair) return null
      if (item !== null && mapped) return null
      if (pair && items.length && !mapped) return null

      if (item !== null) {
        items.push(unquoted(item))
        writtenItems.push(item)
      } else {
        mapped = true
        items.push(`${pair?.[1] ?? ''}: ${unquoted(pair?.[2] ?? '')}`.trim())
        writtenItems.push(pair?.[2] ?? '')
      }

      last = next.to
      at++
    }

    out.push({
      key,
      kind: mapped ? 'map' : items.length ? 'list' : 'text',
      value: '',
      items,
      ...quotes(writtenItems, !mapped),
      from: line.from,
      to: last,
    })
  }

  return out
}

export function keyCalled(rows: readonly Property[], key: string): Property | undefined {
  const wanted = key.toLowerCase()
  return rows.find((one) => one.key === key) ?? rows.find((one) => one.key.toLowerCase() === wanted)
}

function quotes(
  written: readonly string[],
  list: boolean,
): { quotedItems?: boolean[]; writtenItems?: string[] } {
  const quoted = written.map(isQuoted)
  if (!quoted.includes(true)) return {}
  return list ? { quotedItems: quoted, writtenItems: [...written] } : { quotedItems: quoted }
}

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

export function propertiesSource(source: string): string {
  const block = frontMatterBlock(source)
  if (!block) return ''

  return `<pre class="properties-source">${escape(source.slice(block.body.from, block.body.to))}</pre>`
}

function value(property: Property): string {
  if (property.kind === 'list' || property.kind === 'map') {
    return property.items.map((one) => `<span class="property-chip">${escape(one)}</span>`).join('')
  }

  if (property.kind === 'checkbox') {
    const on = property.value.toLowerCase() === 'true'
    return `<span class="property-check${on ? ' is-on' : ''}" role="img" aria-label="${on ? 'true' : 'false'}"></span>`
  }

  if (property.value === '') return '<span class="property-empty"></span>'

  return `<span class="property-said" data-kind="${property.kind}">${escape(property.value)}</span>`
}
