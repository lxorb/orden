import type { Chip, ChipKind } from '@orden/bases/language'
import { oneEdit } from '@orden/markdown/edits'

export interface Piece {
  text: string
  chip?: ChipKind
  from: number
}

export function piecesOf(text: string, chips: readonly Chip[]): Piece[] {
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

export interface Span {
  from: number
  to: number
}

export function carried(spans: readonly Span[], before: string, after: string): Span[] {
  const edit = oneEdit(before, after)
  if (!edit) return [...spans]
  const shift = edit.insert.length - (edit.to - edit.from)
  const out: Span[] = []
  for (const span of spans) {
    if (span.to <= edit.from) out.push(span)
    else if (span.from >= edit.to) out.push({ from: span.from + shift, to: span.to + shift })
  }
  return out
}

export function without(text: string, span: Span): string {
  const before = text.slice(0, span.from).replace(/\s+$/u, '')
  const after = text.slice(span.to).replace(/^\s+/u, '')
  return before && after ? `${before} ${after}` : before + after
}

export function pastedLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+•]|\d{1,9}[.)])\s+/u, '')
        .replace(/^\[.\]\s+/u, '')
        .trim(),
    )
    .filter(Boolean)
}

export interface Token {
  sign: '#' | '@' | '%' | '>' | '/'
  query: string
  from: number
  to: number
}

const SIGNS = new Set(['#', '@', '%', '>', '/'])

export function tokenAt(text: string, caret: number): Token | null {
  let from = caret
  while (from > 0 && !/\s/u.test(text.charAt(from - 1))) from--
  const word = text.slice(from, caret)
  const sign = word.charAt(0)
  if (!SIGNS.has(sign)) return null
  const slash = sign === '>' ? word.lastIndexOf('/') : -1
  if (slash > 0) return { sign: '/', query: word.slice(slash + 1), from: from + slash, to: caret }
  if (!/\s/u.test(text.charAt(caret)) && caret < text.length) return null
  return { sign: sign as Token['sign'], query: word.slice(1), from, to: caret }
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
