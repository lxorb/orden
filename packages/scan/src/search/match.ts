import { frontMatterBlock } from '@orden/markdown/front-matter'
import { taskAt } from '@orden/markdown/tasks'
import { lineAt, lineStarts } from './lines'
import { isEmpty, type Query, type Unit } from './query'
import { tagsIn } from './tags'

export interface SearchNote {
  path: string
  relative: string
  name: string
  body: string
  folded?: (() => string) | undefined
  starts?: (() => readonly number[]) | undefined
}

export function foldedOnce(body: string): () => string {
  let made: string | null = null
  return () => (made ??= fold(body))
}

export interface Range {
  from: number
  to: number
}

export interface Span extends Range {
  groups?: readonly string[]
}

export interface Hit {
  path: string
  name: string
  line: number
  page?: number
  tab?: string
  text: string
  ranges: Range[]
  bare?: true
  score?: number
}

const LINE = 200

const HEADING = /^ {0,3}#{1,6}(\s|$)/

export interface Work {
  notes: number
  regions: number
  needles: number
  characters: number
}

function nothing(): Work {
  return { notes: 0, regions: 0, needles: 0, characters: 0 }
}

const work = nothing()

export function workDone(): Work {
  const done = { ...work }
  Object.assign(work, nothing())
  return done
}

export function fold(text: string): string {
  const lowered = text.toLowerCase()
  if (lowered.length === text.length) return lowered

  let out = ''
  for (const letter of text) {
    const lower = letter.toLowerCase()
    out += lower.length === letter.length ? lower : letter
  }

  return out
}

const A_TASK: Partial<Record<Unit, 'any' | 'todo' | 'done'>> = {
  task: 'any',
  'task-todo': 'todo',
  'task-done': 'done',
}

function unitsIn(body: string, starts: readonly number[], unit: Unit): Range[] {
  const ends = starts.map((_start, index) => {
    const next = starts[index + 1]
    return next === undefined ? body.length : next - 1
  })

  if (unit === 'line') {
    return starts.map((from: number, index: number) => ({ from, to: ends[index] ?? body.length }))
  }

  const state = A_TASK[unit]
  if (state) {
    const found: Range[] = []

    for (const [index, start] of starts.entries()) {
      const end = ends[index] ?? body.length
      const task = taskAt(body.slice(start, end))
      if (!task) continue
      if (state === 'todo' && task.done) continue
      if (state === 'done' && !task.done) continue

      found.push({ from: start + task.marker, to: end })
    }

    return found
  }

  const out: Range[] = []
  let open: number | null = null

  const close = (to: number) => {
    if (open !== null) out.push({ from: open, to })
    open = null
  }

  for (const [index, start] of starts.entries()) {
    const end = ends[index] ?? body.length
    const text = body.slice(start, end)

    if (unit === 'block') {
      if (text.trim() === '') close(ends[index - 1] ?? start)
      else open ??= start
      continue
    }

    if (HEADING.test(text)) {
      close(ends[index - 1] ?? start)
      open = start
    } else open ??= start
  }

  close(body.length)
  return out
}

function frontMatter(body: string): Map<string, string> {
  const out = new Map<string, string>()
  const block = frontMatterBlock(body)
  if (!block) return out

  for (const line of body.slice(block.body.from, block.body.to).split('\n')) {
    if (/^\s/.test(line)) continue

    const colon = line.indexOf(':')
    if (colon <= 0) continue

    out.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
  }

  return out
}

interface Facts {
  note: SearchNote
  folded: string | null
  starts: readonly number[] | null
  tags: string[] | null
  front: Map<string, string> | null
  words: number | null
  units: Partial<Record<Unit, Range[]>>
  places: Map<string, number[]>
}

function foldedOf(facts: Facts): string {
  return (facts.folded ??= facts.note.folded?.() ?? fold(facts.note.body))
}

function startsOf(facts: Facts): readonly number[] {
  return (facts.starts ??= facts.note.starts?.() ?? lineStarts(facts.note.body))
}

function tagsOf(facts: Facts): string[] {
  return (facts.tags ??= tagsIn(facts.note.body).map((tag) => tag.slice(1).toLowerCase()))
}

function frontOf(facts: Facts): Map<string, string> {
  return (facts.front ??= frontMatter(facts.note.body))
}

function wordsIn(body: string): number {
  return frontMatterBlock(body)?.to ?? 0
}

function wordsFrom(facts: Facts): number {
  return (facts.words ??= wordsIn(facts.note.body))
}

function unitsOf(facts: Facts, unit: Unit): Range[] {
  return (facts.units[unit] ??= unitsIn(facts.note.body, startsOf(facts), unit))
}

const A_NUMBER = /^-?\d+(?:\.\d+)?$/
const A_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/

function order(value: string, asked: string): number {
  const one = value.trim()
  const other = asked.trim()

  if (A_NUMBER.test(one) && A_NUMBER.test(other)) {
    const here = Number(one)
    const there = Number(other)
    return here < there ? -1 : here > there ? 1 : 0
  }

  const dates = A_DATE.test(one) && A_DATE.test(other)
  const left = dates ? one.replace(' ', 'T') : one.toLowerCase()
  const right = dates ? other.replace(' ', 'T') : other.toLowerCase()
  return left < right ? -1 : left > right ? 1 : 0
}

function heldAgainst(value: string, query: Extract<Query, { kind: 'property' }>): boolean {
  const asked = query.value
  if (asked === null) return true

  switch (query.compare) {
    case 'has':
      return contains(value, asked, true)
    case 'is':
      return value.trim().toLowerCase() === asked.trim().toLowerCase()
    case 'lt':
      return order(value, asked) < 0
    case 'lte':
      return order(value, asked) <= 0
    case 'gt':
      return order(value, asked) > 0
    case 'gte':
      return order(value, asked) >= 0
    case 'range':
      return order(value, asked) >= 0 && order(value, query.upto ?? asked) <= 0
    case 'null':
      return false
  }
}

function pastFrontMatter(body: string, starts: readonly number[]): number {
  const block = frontMatterBlock(body)
  if (!block) return 0

  const past = starts.findIndex((start) => start > block.close)
  return past === -1 ? starts.length : past
}

function contains(hay: string, needle: string, folded: boolean): boolean {
  return folded ? hay.toLowerCase().includes(needle.toLowerCase()) : hay.includes(needle)
}

function placesIn(facts: Facts, hay: string, needle: string, folded: boolean): number[] {
  const key = `${folded ? 'i' : ' '}${needle}`
  const held = facts.places.get(key)
  if (held) return held

  work.needles += 1
  work.characters += hay.length

  const found: number[] = []
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
    found.push(at)
  }

  facts.places.set(key, found)
  return found
}

function firstFrom(places: readonly number[], from: number): number {
  let low = 0
  let high = places.length

  while (low < high) {
    const middle = (low + high) >> 1
    if ((places[middle] ?? 0) < from) low = middle + 1
    else high = middle
  }

  return low
}

function literals(places: readonly number[], length: number, region: Range): Span[] | null {
  const out: Span[] = []
  const last = region.to - length

  for (let index = firstFrom(places, region.from); index < places.length; index++) {
    const at = places[index]
    if (at === undefined || at > last) break
    out.push({ from: at, to: at + length })
  }

  return out.length ? out : null
}

function clip(one: Range, other: Range): Range | null {
  const from = Math.max(one.from, other.from)
  const to = Math.min(one.to, other.to)
  return from <= to ? { from, to } : null
}

export class Matcher {
  private readonly patterns = new Map<string, RegExp | null>()
  private readonly needles = new Map<string, string>()

  constructor(private readonly query: Query) {}

  spans(note: SearchNote): Span[] | null {
    const facts: Facts = {
      note,
      folded: null,
      starts: null,
      tags: null,
      front: null,
      words: null,
      units: {},
      places: new Map(),
    }

    work.notes += 1
    return this.walk(this.query, facts, { from: 0, to: note.body.length })
  }

  hits(note: SearchNote, most: number): Hit[] {
    const spans = this.spans(note)
    if (!spans || most <= 0) return []

    const starts = note.starts?.() ?? lineStarts(note.body)
    const past = pastFrontMatter(note.body, starts)

    if (!spans.length) {
      const line = starts.findIndex((start, index) => {
        if (index < past) return false
        return note.body.slice(start, starts[index + 1] ?? note.body.length).trim()
      })

      return [this.row(note, starts, Math.max(line, 0), [])]
    }

    const byLine = new Map<number, Range[]>()
    for (const span of [...spans].sort((a, b) => a.from - b.from)) {
      const line = lineAt(starts, span.from)
      const held = byLine.get(line)
      if (held) held.push(span)
      else byLine.set(line, [span])
    }

    return [...byLine.entries()]
      .slice(0, most)
      .map(([line, ranges]) => this.row(note, starts, line, ranges))
  }

  private row(note: SearchNote, starts: readonly number[], line: number, ranges: Range[]): Hit {
    const from = starts[line] ?? 0
    const next = starts[line + 1]
    const raw = note.body.slice(from, next === undefined ? note.body.length : next - 1)
    const lead = raw.length - raw.trimStart().length
    const text = Array.from(raw.trim()).slice(0, LINE).join('')

    const moved: Range[] = []
    for (const range of ranges) {
      const start = Math.max(range.from - from - lead, 0)
      const end = Math.min(range.to - from - lead, text.length)
      if (start < end) moved.push({ from: start, to: end })
    }

    const hit: Hit = { path: note.path, name: note.name, line, text, ranges: moved }
    if (!ranges.some((range) => range.from < range.to)) hit.bare = true
    return hit
  }

  private walk(query: Query, facts: Facts, region: Range): Span[] | null {
    switch (query.kind) {
      case 'all': {
        const out: Span[] = []
        for (const one of query.of) {
          const found = this.walk(one, facts, region)
          if (!found) return null
          out.push(...found)
        }

        return out
      }

      case 'any': {
        const out: Span[] = []
        let answered = false
        for (const one of query.of) {
          const found = this.walk(one, facts, region)
          if (!found) continue

          answered = true
          out.push(...found)
        }

        return answered ? out : null
      }

      case 'not':
        return this.walk(query.of, facts, region) ? null : []

      case 'text':
      case 'content': {
        const needle = query.fold ? this.folded(query.text) : query.text
        if (!needle) return null

        const within =
          query.kind === 'content'
            ? clip({ from: wordsFrom(facts), to: facts.note.body.length }, region)
            : region
        if (!within) return null

        const hay = query.fold ? foldedOf(facts) : facts.note.body
        return literals(placesIn(facts, hay, needle, query.fold), needle.length, within)
      }

      case 'regex':
        return this.matches(query.source, query.fold, facts.note.body, region)

      case 'path':
        return contains(facts.note.relative, query.text, query.fold) ? [] : null

      case 'file':
        return contains(facts.note.name, query.text, query.fold) ? [] : null

      case 'tag': {
        const wanted = query.tag.toLowerCase()
        const has = tagsOf(facts).some((tag) => tag === wanted || tag.startsWith(`${wanted}/`))

        return has ? [] : null
      }

      case 'property': {
        const value = frontOf(facts).get(query.name)

        if (query.compare === 'null') return value?.trim() ? null : []
        if (value === undefined) return null

        return heldAgainst(value, query) ? [] : null
      }

      case 'scope': {
        const out: Span[] = []
        let answered = false
        const bare = isEmpty(query.of)

        for (const unit of unitsOf(facts, query.unit)) {
          const within = clip(unit, region)
          if (!within) continue

          work.regions += 1
          const found = this.walk(query.of, facts, within)
          if (!found) continue

          answered = true
          if (bare) out.push({ from: within.from, to: within.from })
          else out.push(...found)
        }

        return answered ? out : null
      }
    }
  }

  private folded(text: string): string {
    const held = this.needles.get(text)
    if (held !== undefined) return held

    const made = fold(text)
    this.needles.set(text, made)
    return made
  }

  private pattern(source: string, folded: boolean): RegExp | null {
    const key = `${folded ? 'i' : ''}\0${source}`
    const held = this.patterns.get(key)
    if (held !== undefined) return held

    let made: RegExp | null
    try {
      made = new RegExp(source, folded ? 'gi' : 'g')
    } catch {
      made = null
    }

    this.patterns.set(key, made)
    return made
  }

  private matches(source: string, folded: boolean, body: string, region: Range): Span[] | null {
    const pattern = this.pattern(source, folded)
    if (!pattern) return null

    const whole = region.from === 0 && region.to === body.length
    const text = whole ? body : body.slice(region.from, region.to)
    const out: Span[] = []
    pattern.lastIndex = 0

    for (;;) {
      const found = pattern.exec(text)
      if (!found) break

      const from = found.index
      const to = from + found[0].length

      if (to === from) {
        pattern.lastIndex = from + 1
        continue
      }

      out.push({
        from: region.from + from,
        to: region.from + to,
        groups: Array.from({ length: found.length - 1 }, (_, index) => found[index + 1] ?? ''),
      })

      pattern.lastIndex = to
    }

    return out.length ? out : null
  }
}
