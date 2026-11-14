import { foldName } from '@orden/markdown/links'
import { fuzzyFolded } from './matching/src/api'

export const WAIT = 600

export interface Reading {
  shown: number[]
  best: number
  go: number | null
  waits: boolean
}

export function isNumber(typed: string): boolean {
  return /^\d/.test(typed)
}

function numbered(typed: string, count: number): number[] {
  const out: number[] = []
  for (let at = 0; at < count; at++) if (String(at + 1).startsWith(typed)) out.push(at)
  return out
}

function named(typed: string, names: readonly string[]): { at: number; score: number }[] {
  const needle = foldName(typed.trim())
  return names.flatMap((name, at) => {
    const score = fuzzyFolded(needle, foldName(name))
    return score === null ? [] : [{ at, score }]
  })
}

export function read(typed: string, names: readonly string[]): Reading {
  const all = names.map((_, at) => at)
  if (!typed) return { shown: all, best: -1, go: null, waits: false }

  if (isNumber(typed)) {
    const shown = numbered(typed, names.length)
    const exact = Number(typed) - 1
    const hits = shown.includes(exact)
    return {
      shown,
      best: hits ? exact : (shown[0] ?? -1),
      go: hits && shown.length === 1 ? exact : null,
      waits: hits && shown.length > 1,
    }
  }

  const found = named(typed, names)
  const best = found.reduce<{ at: number; score: number } | null>(
    (top, one) => (top === null || one.score > top.score ? one : top),
    null,
  )
  return { shown: found.map((one) => one.at), best: best?.at ?? -1, go: null, waits: false }
}

export function typedOn(typed: string, character: string, names: readonly string[]): string | null {
  if (character === ' ' && !typed) return null

  const next = typed + character
  return read(next, names).shown.length ? next : null
}

export function typedBy(key: string, code: string, typed: string): string | null {
  const digit = /^Digit(\d)$/.exec(code)?.[1]
  if (digit !== undefined && (!typed || isNumber(typed))) return digit
  return /^.$/u.test(key) ? key : null
}
