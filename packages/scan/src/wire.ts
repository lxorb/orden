import type { ScannedRows, ScannedTask, Stamp } from '@orden/bases/scan'
import type { LinkKind } from '@orden/markdown/links'
import type { ScannedNote } from './scan-note'
import type { FuzzyHit } from './search/fuzzy'
import type { Hit, Range } from './search/match'
import type { Query, Unit } from './search/query'

const INDEX_BATCH = 200

const MOST_HITS = 200

const MOST_SKIPPED = 5000

const MOST_EXCLUDED = 2000

const LONGEST = 4096

const DEEPEST = 32

export type IndexedNote = ScannedNote & Partial<ScannedRows> & { stamp?: Stamp | null }

export type IndexItem =
  { id: string; docSeq: number; scan: IndexedNote | null } | { id: string; refused: 'gone' }

export interface IndexRequest {
  ids: string[]
}

export interface SearchRequest {
  query: Query
  terms: string[]
  limit: number
  after?: string
  skip?: string[]
  excluded?: string[]
}

export type FoundHit = Hit & { id: string }
export type FoundLoose = FuzzyHit & { id: string }

export interface SearchAnswer {
  hits: FoundHit[]
  loose: FoundLoose[]
  after: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= LONGEST
}

function isId(value: unknown): value is string {
  return isText(value) && value.length > 0
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isTexts(value: unknown, most = Infinity): value is string[] {
  return Array.isArray(value) && value.length <= most && value.every(isText)
}

function isIds(value: unknown, most: number): value is string[] {
  return Array.isArray(value) && value.length <= most && value.every(isId)
}

const UNITS: readonly Unit[] = ['line', 'block', 'section', 'task', 'task-todo', 'task-done']
const COMPARES = ['has', 'is', 'null', 'lt', 'lte', 'gt', 'gte', 'range']

export function queryOf(value: unknown, depth = 0): Query | null {
  if (!isRecord(value) || depth > DEEPEST) return null
  const deeper = (one: unknown) => queryOf(one, depth + 1)
  const fold = value.fold === true
  switch (value.kind) {
    case 'all':
    case 'any': {
      if (!Array.isArray(value.of)) return null
      const of: Query[] = []
      for (const one of value.of) {
        const read = deeper(one)
        if (!read) return null
        of.push(read)
      }
      return { kind: value.kind, of }
    }
    case 'not': {
      const of = deeper(value.of)
      return of ? { kind: 'not', of } : null
    }
    case 'text':
    case 'content':
    case 'path':
    case 'file':
      return isText(value.text) && typeof value.fold === 'boolean'
        ? { kind: value.kind, text: value.text, fold }
        : null
    case 'regex':
      return isText(value.source) && typeof value.fold === 'boolean'
        ? { kind: 'regex', source: value.source, fold }
        : null
    case 'tag':
      return isText(value.tag) ? { kind: 'tag', tag: value.tag } : null
    case 'property': {
      const compare = COMPARES.find((one) => one === value.compare)
      if (!isText(value.name) || !(value.value === null || isText(value.value)) || !compare)
        return null
      const query: Query = {
        kind: 'property',
        name: value.name,
        value: value.value,
        compare: compare as Extract<Query, { kind: 'property' }>['compare'],
      }
      if (value.upto !== undefined) {
        if (!isText(value.upto)) return null
        query.upto = value.upto
      }
      return query
    }
    case 'scope': {
      const unit = UNITS.find((one) => one === value.unit)
      const of = deeper(value.of)
      return unit && of ? { kind: 'scope', unit, of } : null
    }
    default:
      return null
  }
}

export function indexRequestOf(value: unknown): IndexRequest | null {
  if (!isRecord(value) || !isIds(value.ids, INDEX_BATCH)) return null
  return { ids: value.ids }
}

export function searchRequestOf(value: unknown): SearchRequest | null {
  if (!isRecord(value)) return null
  const query = queryOf(value.query)
  const { limit } = value
  if (!query || !isTexts(value.terms, 64) || !isCount(limit) || limit < 1 || limit > MOST_HITS)
    return null
  const request: SearchRequest = { query, terms: value.terms, limit }
  if (value.after !== undefined) {
    if (!isText(value.after)) return null
    request.after = value.after
  }
  if (value.skip !== undefined) {
    if (!isIds(value.skip, MOST_SKIPPED)) return null
    request.skip = value.skip
  }
  if (value.excluded !== undefined) {
    if (!isTexts(value.excluded, MOST_EXCLUDED)) return null
    request.excluded = value.excluded
  }
  return request
}

const LINK_KINDS: readonly LinkKind[] = ['wikilink', 'markdown']

function isLink(value: unknown): boolean {
  return (
    isRecord(value) &&
    LINK_KINDS.some((one) => one === value.kind) &&
    typeof value.target === 'string' &&
    isTextOrNull(value.heading) &&
    isTextOrNull(value.block) &&
    isTextOrNull(value.alias) &&
    typeof value.embed === 'boolean' &&
    isCount(value.line) &&
    typeof value.text === 'string'
  )
}

function isTask(value: unknown): value is ScannedTask {
  return (
    isRecord(value) &&
    isCount(value.line) &&
    isCount(value.indent) &&
    typeof value.mark === 'string' &&
    typeof value.text === 'string' &&
    Array.isArray(value.section) &&
    value.section.every((one) => typeof one === 'string') &&
    (value.description === undefined || typeof value.description === 'string') &&
    (value.comments === undefined || isCount(value.comments))
  )
}

function isStamp(value: unknown): value is Stamp {
  return isRecord(value) && isCount(value.size) && isCount(value.mtime) && isCount(value.ctime)
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((one) => typeof one === 'string')
}

export function indexedOf(value: unknown): IndexedNote | null {
  if (!isRecord(value)) return null
  const fields =
    typeof value.path === 'string' &&
    typeof value.name === 'string' &&
    strings(value.headings) &&
    strings(value.blocks) &&
    strings(value.tags) &&
    strings(value.aliases) &&
    Array.isArray(value.links) &&
    value.links.every(isLink) &&
    isTextOrNull(value.icon) &&
    isTextOrNull(value.iconColor) &&
    isTextOrNull(value.url) &&
    isTextOrNull(value.favicon) &&
    isTextOrNull(value.address) &&
    isTextOrNull(value.cover) &&
    typeof value.bare === 'boolean'
  if (!fields) return null
  if (value.front !== undefined && !isTextOrNull(value.front)) return null
  if (value.tasks !== undefined && !(Array.isArray(value.tasks) && value.tasks.every(isTask)))
    return null
  if (value.stamp !== undefined && value.stamp !== null && !isStamp(value.stamp)) return null
  return value as unknown as IndexedNote
}

function indexItemOf(value: unknown): IndexItem | null {
  if (!isRecord(value) || !isId(value.id)) return null
  if (value.refused === 'gone') return { id: value.id, refused: 'gone' }
  if (!isCount(value.docSeq)) return null
  if (value.scan === null) return { id: value.id, docSeq: value.docSeq, scan: null }
  const scan = indexedOf(value.scan)
  return scan ? { id: value.id, docSeq: value.docSeq, scan } : null
}

export function indexAnswerOf(value: unknown): IndexItem[] | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null
  return value.items.flatMap((one) => {
    const item = indexItemOf(one)
    return item ? [item] : []
  })
}

function isRanges(value: unknown): value is Range[] {
  return (
    Array.isArray(value) &&
    value.every((one) => isRecord(one) && isCount(one.from) && isCount(one.to))
  )
}

function isHit(value: unknown): value is FoundHit {
  return (
    isRecord(value) &&
    isId(value.id) &&
    typeof value.path === 'string' &&
    typeof value.name === 'string' &&
    isCount(value.line) &&
    typeof value.text === 'string' &&
    isRanges(value.ranges) &&
    (value.bare === undefined || value.bare === true) &&
    (value.score === undefined || typeof value.score === 'number')
  )
}

function isLoose(value: unknown): value is FoundLoose {
  return isRecord(value) && typeof value.score === 'number' && isHit(value)
}

export function searchAnswerOf(value: unknown): SearchAnswer | null {
  if (!isRecord(value) || !(value.after === null || isText(value.after))) return null
  if (!Array.isArray(value.hits) || !value.hits.every(isHit)) return null
  if (!Array.isArray(value.loose) || !value.loose.every(isLoose)) return null
  return { hits: value.hits, loose: value.loose, after: value.after }
}
