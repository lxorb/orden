import { fit } from '@orden/scan/search/fuzzy'
import { OPERATORS } from '@orden/scan/search/query'

type Field = 'path' | 'file' | 'tag'

type Finishing = Field | 'name'

export interface Completing {
  field: Finishing
  typed: string
  from: number
  to: number
  quoted: boolean
}

const QUOTED = /(?:^|[\s(-])(path|file|tag):"([^"\n]*)$/i
const BARE = /(?:^|[\s(-])(path|file|tag):([^\s")]*)$/i

const FIELDS: readonly Field[] = ['path', 'file', 'tag']

const NAME = /(?:^|[\s(-])([A-Za-z][A-Za-z-]*)$/

export function completing(source: string, caret: number): Completing | null {
  const before = source.slice(0, caret)
  const quoted = QUOTED.exec(before)
  const found = quoted ?? BARE.exec(before)
  const [, name, typed] = found ?? []
  if (name === undefined || typed === undefined) return null

  const field = FIELDS.find((one) => one === name.toLowerCase())
  if (!field) return null

  return { field, typed, from: caret - typed.length, to: caret, quoted: quoted !== null }
}

export function naming(source: string, caret: number): Completing | null {
  const found = NAME.exec(source.slice(0, caret))
  const typed = found?.[1]
  if (typed === undefined) return null

  const folded = typed.toLowerCase()
  if (!OPERATORS.some((one) => one.startsWith(folded))) return null

  return { field: 'name', typed, from: caret - typed.length, to: caret, quoted: false }
}

const MOST = 12

export function offered(typed: string, values: readonly string[]): string[] {
  const needle = typed.trim().toLowerCase()
  if (!needle) return values.slice(0, MOST)

  const starts: string[] = []
  const holds: string[] = []

  for (const value of values) {
    const folded = value.toLowerCase()
    if (folded.startsWith(needle)) starts.push(value)
    else if (folded.includes(needle)) holds.push(value)
  }

  return [...starts, ...holds].slice(0, MOST)
}

export function nearest(typed: string, values: readonly string[]): string[] {
  const needle = typed.trim()
  if (!needle) return values.slice(0, MOST)

  return values
    .flatMap((value) => {
      const found = fit(needle, value)
      return found ? [{ value, score: found.score }] : []
    })
    .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value))
    .slice(0, MOST)
    .map((one) => one.value)
}

export function chosen(
  source: string,
  at: Completing,
  value: string,
): { text: string; caret: number } {
  const written = !at.quoted && /\s/.test(value) ? `"${value}"` : value
  const closed = source.charAt(at.to) === '"'
  const tail = at.quoted && !closed ? '"' : ''

  const text = source.slice(0, at.from) + written + tail + source.slice(at.to)
  const past = at.quoted && closed ? 1 : 0
  return { text, caret: at.from + written.length + tail.length + past }
}
