import { fold, type Range, type SearchNote } from './match'
import type { Query } from './query'

const LETTER = 16

const RUN = 12

const START = 8
const FIRST = 2

const GAP = 3
const GAP_ON = 1

const WORST = 12

const BOUNDARY = new Set([
  '\n',
  '\r',
  ' ',
  '\t',
  '/',
  '\\',
  '_',
  '-',
  '.',
  ',',
  ':',
  ';',
  '(',
  '[',
  '{',
  '#',
  '*',
  '>',
  '"',
  "'",
])

const SCORED = 400

const SHOWN = 200

const ENDS = new Uint8Array(128)
for (const one of BOUNDARY) ENDS[one.charCodeAt(0)] = 1

const SMALL_A = 97
const SMALL_Z = 122
const ASCII = 128

export interface Work {
  notes: number
  lines: number
  terms: number
  characters: number
}

function nothing(): Work {
  return { notes: 0, lines: 0, terms: 0, characters: 0 }
}

const work = nothing()

export function workDone(): Work {
  const done = { ...work }
  Object.assign(work, nothing())
  return done
}

function isLower(letter: string): boolean {
  return letter !== '' && letter === letter.toLowerCase() && letter !== letter.toUpperCase()
}

function opens(body: string, at: number): boolean {
  if (at === 0) return true

  const before = body.charCodeAt(at - 1)
  if (before >= ASCII) return isLower(body.charAt(at - 1)) && !isLower(body.charAt(at))
  if (ENDS[before]) return true
  if (before < SMALL_A || before > SMALL_Z) return false

  const here = body.charCodeAt(at)
  return here >= ASCII ? !isLower(body.charAt(at)) : here < SMALL_A || here > SMALL_Z
}

function seek(folded: string, letter: string, from: number): number {
  const at = folded.indexOf(letter, from)
  work.characters += (at === -1 ? folded.length : at + letter.length) - from
  return at
}

function placeIn(folded: string, letter: string, cursor: number, to: number): number {
  if (letter.length === 1) {
    const code = letter.charCodeAt(0)
    for (let at = cursor; at < to; at++) {
      if (folded.charCodeAt(at) === code) return at
    }

    return -1
  }

  for (let at = cursor; at + letter.length <= to; at++) {
    if (folded.startsWith(letter, at)) return at
  }

  return -1
}

function walk(letters: readonly string[], folded: string, at: number, to: number, out: number[]) {
  out.length = 1
  out[0] = at
  let cursor = at + 1

  for (let index = 1; index < letters.length; index++) {
    const letter = letters[index] ?? ''
    const found = placeIn(folded, letter, cursor, to)
    work.characters += (found === -1 ? to : found + letter.length) - cursor
    if (found === -1) return false

    out.push(found)
    cursor = found + 1
  }

  return true
}

function worth(body: string, at: readonly number[]): number {
  let score = at.length * LETTER
  let previous = -2

  for (let index = 0; index < at.length; index++) {
    const position = at[index] ?? 0

    if (index > 0 && position === previous + 1) score += RUN
    else if (opens(body, position)) score += START * (index === 0 ? FIRST : 1)

    if (index > 0) score -= gap(position - previous - 1)
    previous = position
  }

  return score
}

function gap(missing: number): number {
  if (missing <= 0) return 0

  const counted = Math.min(missing, WORST)
  return GAP + (counted - 1) * GAP_ON
}

function fitAt(
  letters: readonly string[],
  body: string,
  folded: string,
  to: number,
  first: number,
  kept: number[],
  tried: number[],
): { score: number; next: number } | null {
  work.terms += 1
  let score: number | null = null
  let at = first
  let next = first

  while (at !== -1 && at < to) {
    if (!walk(letters, folded, at, to, tried)) break

    const worthIt = worth(body, tried)
    if (score === null || worthIt > score) {
      score = worthIt
      kept.length = 0
      for (const one of tried) kept.push(one)
    }

    at = seek(folded, letters[0] ?? '', at + 1)
    next = at
  }

  return score === null ? null : { score, next }
}

export function fit(term: string, line: string): { score: number; ranges: Range[] } | null {
  const letters = lettersOf(term)
  if (!letters.length) return null

  const text = line.length > SCORED ? line.slice(0, SCORED) : line
  const folded = fold(text)
  const first = seek(folded, letters[0] ?? '', 0)
  if (first === -1) return null

  const kept: number[] = []
  const found = fitAt(letters, text, folded, text.length, first, kept, [])
  return found ? { score: found.score, ranges: ranges(kept) } : null
}

function lettersOf(term: string): string[] {
  return Array.from(fold(term))
}

function ranges(at: readonly number[]): Range[] {
  const out: Range[] = []

  for (const position of at) {
    const last = out.at(-1)
    if (last?.to === position) last.to = position + 1
    else out.push({ from: position, to: position + 1 })
  }

  return out
}

export function fuzzyTerms(query: Query): string[] {
  const out: string[] = []
  return gather(query, out) ? out : []
}

function gather(query: Query, out: string[]): boolean {
  switch (query.kind) {
    case 'all':
      return query.of.every((one) => gather(one, out))

    case 'text': {
      if (!query.fold || /\s/.test(query.text)) return false

      out.push(fold(query.text))
      return true
    }

    case 'path':
    case 'file':
    case 'tag':
    case 'property':
      return true

    case 'content':
    case 'any':
    case 'not':
    case 'regex':
    case 'scope':
      return false
  }
}

export function withoutWords(query: Query): Query {
  if (query.kind === 'text') return { kind: 'all', of: [] }
  if (query.kind !== 'all') return query

  return { kind: 'all', of: query.of.filter((one) => one.kind !== 'text').map(withoutWords) }
}

export interface FuzzyHit {
  path: string
  name: string
  line: number
  text: string
  ranges: Range[]
  score: number
}

export class Fuzzy {
  private readonly words: string[][]

  constructor(terms: readonly string[]) {
    this.words = terms.map(lettersOf).filter((one) => one.length > 0)
  }

  get asks(): boolean {
    return this.words.length > 0
  }

  best(note: SearchNote): FuzzyHit | null {
    const words = this.words
    if (!words.length) return null

    work.notes += 1
    const body = note.body
    const folded = note.folded?.() ?? fold(body)

    const next: number[] = []
    for (const letters of words) {
      const at = seek(folded, letters[0] ?? '', 0)
      if (at === -1) return null
      next.push(at)
    }

    let bestScore = 0
    let bestLine = -1
    let bestFrom = 0
    let bestEnd = 0
    let bestPositions: number[] = []

    const positions: number[] = []
    const kept: number[] = []
    const tried: number[] = []

    let line = 0
    let from = 0
    let gone = false

    while (from <= body.length) {
      const broke = folded.indexOf('\n', from)
      const end = broke === -1 ? body.length : broke

      if (end > from) {
        work.lines += 1
        const to = end - from > SCORED ? from + SCORED : end
        positions.length = 0
        let score = 0
        let all = true

        for (let which = 0; which < words.length; which++) {
          const letters = words[which] ?? []
          let at = next[which] ?? -1

          if (at < from) {
            at = seek(folded, letters[0] ?? '', from)
            if (at === -1) {
              gone = true
              all = false
              break
            }
            next[which] = at
          }

          if (at >= to) {
            all = false
            break
          }

          const found = fitAt(letters, body, folded, to, at, kept, tried)
          if (!found) {
            all = false
            break
          }

          next[which] = found.next === -1 ? body.length : found.next
          score += found.score
          for (const one of kept) positions.push(one)
        }

        if (all && (bestLine === -1 || score > bestScore)) {
          bestScore = score
          bestLine = line
          bestFrom = from
          bestEnd = end
          bestPositions = positions.slice()
        }

        if (gone) break
      }

      if (broke === -1) break
      from = broke + 1
      line++
    }

    if (bestLine === -1) return null
    return this.row(note, bestLine, bestFrom, bestEnd, bestScore, bestPositions)
  }

  private row(
    note: SearchNote,
    line: number,
    from: number,
    end: number,
    score: number,
    positions: readonly number[],
  ): FuzzyHit {
    const raw = note.body.slice(from, end)
    const lead = raw.length - raw.trimStart().length
    const text = Array.from(raw.trim()).slice(0, SHOWN).join('')

    const moved: Range[] = []
    for (const range of ranges([...positions].sort((a, b) => a - b))) {
      const start = Math.max(range.from - from - lead, 0)
      const end = Math.min(range.to - from - lead, text.length)
      if (start >= end) continue

      const last = moved.at(-1)
      if (last && last.to >= start) last.to = Math.max(last.to, end)
      else moved.push({ from: start, to: end })
    }

    return { path: note.path, name: note.name, line, text, ranges: moved, score }
  }
}
