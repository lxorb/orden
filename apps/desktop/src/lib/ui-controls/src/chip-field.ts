import { oneEdit } from '@orden/markdown/edits'

export interface Spot {
  from: number
  to: number
}
export interface Marked extends Spot {
  kind: string
}
export interface Piece {
  text: string
  chip?: string
  from: number
}
export function piecesOf(text: string, chips: readonly Marked[]): Piece[] {
  const out: Piece[] = []
  let at = 0
  for (const chip of [...chips].sort((a, b) => a.from - b.from)) {
    if (chip.from > at) out.push({ text: text.slice(at, chip.from), from: at })
    out.push({ text: text.slice(chip.from, chip.to), chip: chip.kind, from: chip.from })
    at = chip.to
  }
  if (at < text.length) out.push({ text: text.slice(at), from: at })
  return out
}
export function carried(spans: readonly Spot[], before: string, after: string): Spot[] {
  const edit = oneEdit(before, after)
  if (!edit) return [...spans]
  const shift = edit.insert.length - (edit.to - edit.from)
  const out: Spot[] = []
  for (const span of spans) {
    if (span.to <= edit.from) out.push(span)
    else if (span.from >= edit.to) out.push({ from: span.from + shift, to: span.to + shift })
  }
  return out
}
export interface Offer {
  value: string
  label: string
  kind?: string
}
export interface Token {
  sign: string
  query: string
  from: number
  to: number
}
export function tokenAt(text: string, caret: number, signs: readonly string[]): Token | null {
  let from = caret
  while (from > 0 && !/\s/u.test(text.charAt(from - 1))) from--
  const word = text.slice(from, caret)
  const sign = signs.find((one) => one !== '' && word.startsWith(one))
  if (sign === undefined) return null
  if (!/\s/u.test(text.charAt(caret)) && caret < text.length) return null
  return { sign, query: word.slice(sign.length), from, to: caret }
}
export function suggestions(query: string, among: readonly string[], most = 6): string[] {
  const said = query.toLowerCase()
  const starts: string[] = []
  const holds: string[] = []
  for (const one of new Set(among)) {
    const name = one.toLowerCase()
    if (name === said) continue
    if (name.startsWith(said)) starts.push(one)
    else if (said && name.includes(said)) holds.push(one)
  }
  return [...starts, ...holds].slice(0, most)
}
export function chosen(text: string, token: Token, value: string): { text: string; caret: number } {
  const words = `${token.sign}${value} `
  const after = text.slice(token.to).replace(/^\s+/u, '')
  const out = text.slice(0, token.from) + words + after
  return { text: out, caret: token.from + words.length }
}
export function chipEndingAt(chips: readonly Spot[], caret: number): Spot | null {
  return chips.find((chip) => chip.to === caret) ?? null
}
