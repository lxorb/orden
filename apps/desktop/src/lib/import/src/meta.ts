import { plainWords } from '@orden/markdown/escapes'
import {
  frontMatterBlock,
  frontMatterKeys,
  type FrontMatterRow,
  writeFrontMatter,
} from '@orden/markdown/front-matter'
import { TAG_NAME } from '@orden/markdown/tags'

export interface Meta {
  date?: string | null
  updated?: string | null
  tags?: readonly string[]
  extra?: readonly (readonly [string, Property])[]
}

export type Property = FrontMatterRow[1]

export function frontMatterFor(meta: Meta): string {
  const rows: FrontMatterRow[] = []

  if (meta.date) rows.push(['date', meta.date])
  if (meta.updated && meta.updated !== meta.date) rows.push(['updated', meta.updated])

  const { tags, words } = tagList(meta.tags ?? [])
  if (tags.length) rows.push(['tags', tags])
  if (words.length) rows.push(['labels', words])

  const taken = new Set(rows.map(([key]) => key))
  for (const [at, [key, value]] of (meta.extra ?? []).entries()) {
    if (said(value)) rows.push([freeKey(propertyName(key) || `property-${at + 1}`, taken), value])
  }

  const written = writeFrontMatter(rows)
  return written ? `${written}\n\n` : ''
}

function said(value: Property): boolean {
  if (typeof value === 'string') return value.trim() !== ''
  if (typeof value === 'number' || typeof value === 'boolean') return true
  return value.length > 0
}

export function noteText(title: string | null, body: string, meta: Meta = {}, own = false): string {
  const all = body.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '')
  const block = own ? ownBlock(all) : null
  const words = block ? all.slice(block.to).replace(/^(?:[ \t]*\r?\n)+/, '') : all
  const heads = /^#{1,6}\s/.test(words)
  const head = title && !heads ? `${titleHeading(title)}\n\n` : ''
  const props = block ? `${withMeta(all, block.close, meta)}\n\n` : frontMatterFor(meta)

  return `${props}${head}${words}${words ? '\n' : ''}`
}

const KEY_LINE = /^[^\s#-].*?[ \t]*:(?:\s|$)/

const BLOCK_LINE = new RegExp(`${KEY_LINE.source}|^(?:[ \\t]|-(?:\\s|$)|#)`)

function ownBlock(body: string): ReturnType<typeof frontMatterBlock> {
  const block = frontMatterBlock(body)
  if (!block) return null

  const lines = body.slice(block.body.from, block.body.to).split(/\r?\n/)
  if (!KEY_LINE.test(lines[0] ?? '')) return null
  return lines.every((line) => !line.trim() || BLOCK_LINE.test(line)) ? block : null
}

function withMeta(note: string, close: number, meta: Meta): string {
  const says = new Set(frontMatterKeys(note).map((key) => key.toLowerCase()))
  const nl = note.includes('\r\n') ? '\r\n' : '\n'
  const added = frontMatterFor(meta)
    .split('\n')
    .slice(1)
    .filter((line) => line.includes(': ') && !says.has(line.split(': ')[0]?.toLowerCase() ?? ''))

  const fence = note.slice(close).split(/\r?\n/)[0] ?? '---'
  return `${note.slice(0, close)}${added.map((line) => `${line}${nl}`).join('')}${fence}`
}

export function titleHeading(title: string): string {
  const words = plainWords(title.replace(/\s+/g, ' ').trim()).replace(
    /(^|[\s(])#(?=[^\s#])/g,
    '$1\\#',
  )
  return `# ${words.replace(/(^|\s)(#+)$/, '$1\\$2')}`
}

export function keptText(body: string): string {
  if (!body || body.endsWith('\n')) return body
  return `${body}${body.includes('\r\n') ? '\r\n' : '\n'}`
}

export function propertyName(key: string): string {
  return key
    .replace(/[^\p{L}\p{M}\p{N}_ /-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
}

export function freeKey(wanted: string, taken: Set<string>): string {
  let key = wanted
  for (let step = 2; taken.has(key); step += 1) key = `${wanted}-${step}`
  taken.add(key)
  return key
}

const TAG = new RegExp(`^${TAG_NAME}$`, 'u')

export function tagName(label: string): string {
  return tidied(label.replace(/[^\p{L}\p{M}\p{N}\p{Extended_Pictographic}\s/_-]+/gu, '-'))
}

function tidied(label: string): string {
  return label
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/\/{2,}/g, '/')
}

function tagList(labels: readonly string[]): { tags: string[]; words: string[] } {
  const tags: string[] = []
  const words: string[] = []

  for (const label of labels) {
    const name = tagName(label)
    const said = label.trim()
    if (name && name === tidied(label) && TAG.test(name)) {
      if (!tags.includes(name)) tags.push(name)
    } else if (said && !words.includes(said)) {
      words.push(said)
    }
  }

  return { tags, words }
}

export function dayOf(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null

  if (typeof value === 'number' || /^\d{10,19}$/.test(value)) {
    const count = Number(value)
    if (!Number.isFinite(count) || count <= 0) return null
    const digits = Math.floor(Math.abs(count)).toString().length
    const millis = digits <= 10 ? count * 1000 : digits <= 13 ? count : count / 1000
    return dayAt(new Date(millis))
  }

  const instant = instantOf(value)
  if (instant !== null) return dayAt(new Date(instant))

  const compact = /^(\d{4})(\d{2})(\d{2})T\d{6}$/.exec(value)
  if (compact) return dayFrom(Number(compact[1]), Number(compact[2]), Number(compact[3]))

  const written = /^(\d{4})[-_/](\d{1,2})[-_/](\d{1,2})/.exec(value)
  if (written) return dayFrom(Number(written[1]), Number(written[2]), Number(written[3]))

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : dayAt(new Date(parsed))
}

function instantOf(value: string): number | null {
  const found = STAMP.exec(value.trim())
  if (!found) return null

  const [, year, month, day, hour, minute, second = '0', fraction = '0', sign, hours, minutes] =
    found
  if (!dayFrom(Number(year), Number(month), Number(day))) return null
  const east = sign ? (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes ?? 0)) : 0
  const moment = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute) - east,
    Number(second),
    Math.floor(Number(`0.${fraction}`) * 1000),
  )
  return Number.isNaN(moment) ? null : moment
}

const STAMP =
  /^(\d{4})-?(\d{2})-?(\d{2})T(\d{2}):?(\d{2})(?::?(\d{2})(?:[.,](\d+))?)?(?:Z|([+-])(\d{2}):?(\d{2})?)$/i

function dayAt(when: Date): string | null {
  if (Number.isNaN(when.getTime())) return null
  return dayFrom(when.getFullYear(), when.getMonth() + 1, when.getDate())
}

function dayFrom(year: number, month: number, day: number): string | null {
  if (year < 1970 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null

  const written = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return `${year}-${written}`
}
