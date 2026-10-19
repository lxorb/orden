/** The field's own bookkeeping, apart from any element: the line cut into words and
 *  chips for drawing, the spans turned back into words carried through an edit, and a
 *  chip taken out of the line. Pure, so the sheet and the global window share it and a
 *  test can read it. */

import type { Chip, ChipKind } from '@nib/bases/language'
import { oneEdit } from '@nib/markdown/edits'

/** A run of the line: words, or the characters of one chip. */
export interface Piece {
  text: string
  chip?: ChipKind
  /** Where the run starts in the line. */
  from: number
}

/** The line as runs, every chip its own. */
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

/** Spans of the line as they stand after it changed from `before` to `after`: moved
 *  with the words around them, and gone where the edit reached into one, since what was
 *  turned back into words is no longer those words. */
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

/** The line with a span taken out, and the blank it leaves closed up. */
export function without(text: string, span: Span): string {
  const before = text.slice(0, span.from).replace(/\s+$/u, '')
  const after = text.slice(span.to).replace(/^\s+/u, '')
  return before && after ? `${before} ${after}` : before + after
}

/** The tasks a paste holds, one a line: the lines with words in them, each without the
 *  list mark or the box it was copied with, so a list copied out of a note or a mail is
 *  a list of tasks. */
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

/** The word being typed at the caret that asks for a suggestion: a label after `#`, `@`
 *  or `%`, a note after `>`, a heading of that note after `/`. Null where the caret is in
 *  no such word. */
export interface Token {
  sign: '#' | '@' | '%' | '>' | '/'
  /** What has been typed after the sign. */
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
  // A heading is asked for right after a note: `>Home/Kit`.
  const slash = sign === '>' ? word.lastIndexOf('/') : -1
  if (slash > 0) return { sign: '/', query: word.slice(slash + 1), from: from + slash, to: caret }
  if (!/\s/u.test(text.charAt(caret)) && caret < text.length) return null
  return { sign: sign as Token['sign'], query: word.slice(1), from, to: caret }
}

/** What a token could be, the ones that start with what was typed first, then the ones
 *  that hold it; at most `most`. */
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

/** The line with a token's words replaced by what was chosen, and the caret after it. */
export function chosen(text: string, token: Token, value: string): { text: string; caret: number } {
  const words = `${token.sign}${value} `
  const after = text.slice(token.to).replace(/^\s+/u, '')
  const out = text.slice(0, token.from) + words + after
  return { text: out, caret: token.from + words.length }
}
