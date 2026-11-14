import { foldName } from '@orden/markdown/links'
import { fuzzyFolded, nearly } from './match'

export type Kind = 'tab' | 'note' | 'bookmark' | 'host' | 'command' | 'page' | 'heading' | 'setting'

export interface Candidate<T> {
  key: string | null
  kind: Kind
  name: string
  names: readonly string[]
  also: readonly string[]
  lift: number
  use: number
  item: T
}

const KIND: Record<Kind, number> = {
  tab: 14,
  note: 10,
  bookmark: 8,
  host: 6,
  command: 4,
  page: 2,
  heading: 0,
  setting: -16,
}

const SHORT: Record<Kind, number> = {
  tab: 0,
  note: 0,
  bookmark: -4,
  host: -10,
  command: -14,
  page: -10,
  heading: -30,
  setting: -30,
}

const STRONG: Partial<Record<Kind, number>> = { setting: 0.75, page: 0.5, heading: 0.9 }

const EXACT = 40
const PREFIX = 10

const SLIPPED = 0.45

const ALSO = 0.7

const MOST_USE = 40

export const MOST = 50

export const LONGEST = 256

export const MOST_PLACES = 200

interface Typed {
  words: readonly string[]
  typed: string
  short: boolean
}

function typedOf(term: string): Typed {
  const words = term.split(/\s+/).filter(Boolean)
  return { words, typed: words.join(' '), short: term.replace(/\s/g, '').length <= 2 }
}

const ideal = (word: string) => 6 + 8 * (word.length - 1)

function quality(words: readonly string[], reading: string, slips: boolean): number | null {
  let score = 0
  let best = 0

  for (const word of words) {
    const found = fuzzyFolded(word, reading)
    if (found === null) {
      if (!slips || !nearly(word, reading)) return null
      score += SLIPPED * ideal(word)
    } else {
      score += found
    }
    best += ideal(word)
  }

  return best > 0 ? score / best : 0
}

function usePoints(use: number): number {
  return Math.min(MOST_USE, 12 * Math.log2(1 + use))
}

function scored<T>(
  { words, typed, short }: Typed,
  one: Candidate<T>,
  slips: boolean,
): number | null {
  let found = quality(words, one.name, slips)
  let raw = found
  const weigh = (readings: readonly string[], weight: number) => {
    for (const reading of readings) {
      if (found !== null && found >= 1) return
      const other = quality(words, reading, slips)
      if (other === null) continue
      if (raw === null || other > raw) raw = other
      if (found === null || other * weight > found) found = other * weight
    }
  }
  weigh(one.names, 1)
  weigh(one.also, ALSO)

  if (found === null || raw === null || found <= 0) return null
  if (raw < (STRONG[one.kind] ?? 0) && one.use <= 0) return null

  const naming = one.name === typed ? EXACT : one.name.startsWith(typed) ? PREFIX : 0

  return (
    100 * found +
    naming +
    KIND[one.kind] +
    (short ? SHORT[one.kind] : 0) +
    usePoints(one.use) +
    one.lift
  )
}

export function ranked<T>(term: string, candidates: readonly Candidate<T>[], most = MOST): T[] {
  const folded = foldName(term.trim().slice(0, LONGEST))
  if (!folded) return candidates.slice(0, most).map((one) => one.item)
  const typed = typedOf(folded)

  const pass = (slips: boolean) => {
    const out: { item: T; score: number }[] = []
    for (const one of candidates) {
      const score = scored(typed, one, slips)
      if (score !== null) out.push({ item: one.item, score })
    }
    return out
  }

  let found = pass(false)
  if (found.length < 5) found = pass(true)

  return found
    .sort((a, b) => b.score - a.score)
    .slice(0, most)
    .map((one) => one.item)
}
