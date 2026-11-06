import { getAdvW, getTextWidth } from '@evenrealities/pretext'
import { which as emojiNamed } from 'node-emoji'

export function draws(code: number): boolean {
  return getAdvW(code) !== 0
}

function formatting(code: number): boolean {
  return (
    code === 0x00ad ||
    code === 0x061c ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x206a && code <= 0x206f) ||
    code === 0xfeff ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    (code >= 0xe0100 && code <= 0xe01ef)
  )
}

const INSTEAD: Readonly<Record<string, string>> = {
  '`': '‘',
  '✓': '√',
  '✔': '√',
  '☑': '■',
  '☐': '□',
  '☒': '■',
  '✗': '×',
  '✘': '×',
  '✕': '×',
  '✖': '×',
  '◦': '·',
  '∙': '·',
  '∘': '°',
  '‣': '•',
  '⁃': '-',
  '▪': '■',
  '▫': '□',
  '▢': '□',
  '◉': '◎',
  '⊕': '⊙',
  '░': '▒',
  '▓': '▒',
  '▀': '▔',
  '▐': '▕',
  '║': '│',
  '╔': '┌',
  '╗': '┐',
  '╚': '└',
  '╝': '┘',
  '╠': '├',
  '╣': '┤',
  '╦': '┬',
  '╩': '┴',
  '╬': '┼',
  '┄': '─',
  '┅': '─',
  '┈': '─',
  '┉': '─',
  '╌': '─',
  '╍': '─',
  '┆': '│',
  '┇': '│',
  '┊': '│',
  '┋': '│',
  '▸': '▶',
  '▹': '▶',
  '▾': '▼',
  '▿': '▼',
  '◂': '◀',
  '◃': '◀',
  '►': '▶',
  '◄': '◀',
  '∅': 'Ø',
  '∆': 'Δ',
  '⋮': ':',
  '⋯': '…',
  '⏎': '¶',
  '↵': '¶',
  '☰': '≡',
  '≣': '≡',
  '⁕': '*',
  '∗': '*',
  '⁎': '*',
  '⁂': '*',
  '‾': '_',
  '‗': '_',
  '¯': '-',
  '´': "'",
  '¨': '"',
  '‑': '-',
  '‒': '-',
  '∕': '/',
  '∖': '\\',
  '⇐': '←',
}

export const TICK = INSTEAD['`'] ?? '‘'

const TOFU = '□'

const TAB = 2

const folded = new Map<number, string>()

function drawable(text: string): boolean {
  for (const one of text) {
    if (!draws(one.codePointAt(0) ?? 0)) return false
  }

  return text !== ''
}

const COMBINING = /^\p{Mn}$/u

function insteadOf(one: string): string {
  const mapped = INSTEAD[one]
  if (mapped !== undefined) return mapped

  const wide = one.normalize('NFKD')
  if (wide !== one && drawable(wide)) return wide

  const bare = wide.replace(/\p{Mn}/gu, '')
  if (bare !== one && drawable(bare)) return bare

  const name = emojiNamed(one, { markdown: true })
  if (name) return name

  return COMBINING.test(one) ? '' : TOFU
}

export interface Work {
  folded: number
  instead: number
  measured: number
  broken: number
  cached: number
}

function nothing(): Work {
  return { folded: 0, instead: 0, measured: 0, broken: 0, cached: 0 }
}

const work = nothing()

export function workDone(): Work {
  const done = { ...work }
  Object.assign(work, nothing())
  return done
}

function measure(text: string): number {
  work.measured += 1
  return getTextWidth(text)
}

export function undrawable(text: string): number {
  let letters = 0
  let missing = 0

  for (const one of text.normalize('NFC')) {
    if (!/\p{L}|\p{M}/u.test(one)) continue

    letters += 1
    if (drawable(one)) continue
    if (insteadOf(one) === TOFU) missing += 1
  }

  return letters === 0 ? 0 : missing / letters
}

export function fold(text: string): string {
  work.folded += text.length
  let out = ''
  let column = 0

  for (const one of text.normalize('NFC')) {
    if (one === '\n') {
      out += one
      column = 0
      continue
    }

    if (one === '\t') {
      const gap = TAB - (column % TAB)
      out += ' '.repeat(gap)
      column += gap
      continue
    }

    const code = one.codePointAt(0) ?? 0
    if (code < 0x80) {
      out += code === 0x60 ? TICK : one
      column += 1
      continue
    }

    let known = folded.get(code)
    if (known === undefined) {
      work.instead += 1
      known = formatting(code) ? '' : draws(code) ? one : insteadOf(one)
      folded.set(code, known)
    }

    out += known
    column += known.length
  }

  return out
}

export function width(text: string): number {
  return measure(fold(text))
}

const CJK = /[ᄀ-ᇿ⺀-〿぀-ヿ㄰-㆏㐀-䶿一-鿿ꀀ-꓏가-힯豈-﫿︰-﹏＀-ﾟ]/

function pieces(text: string): string[] {
  const out: string[] = []
  let one = ''

  for (const letter of text) {
    if (letter === ' ') {
      one += letter
      continue
    }

    if (one.endsWith(' ')) {
      out.push(one)
      one = ''
    }

    if (CJK.test(letter)) {
      if (one) out.push(one)
      out.push(letter)
      one = ''
      continue
    }

    one += letter
    if (letter === '-') {
      out.push(one)
      one = ''
    }
  }

  if (one) out.push(one)
  return out
}

function broken(text: string, inner: number, hang: string): string[] {
  const whole = fold(text)
  if (whole === '') return ['']
  if (measure(whole) <= inner) return [whole]

  const out: string[] = []
  let line = ''

  const lead = measure(hang)
  const shown = (row: string) => (out.length === 0 ? row : hang + row)
  const fits = (row: string) => measure(shown(row.trimEnd())) <= inner
  const bare = () => line.trim() === '' || (out.length === 0 && measure(line.trimEnd()) <= lead)
  const push = () => {
    out.push(shown(line.trimEnd()))
    line = ''
  }

  for (const piece of pieces(whole)) {
    if (fits(line + piece)) {
      line += piece
      continue
    }

    if (!bare()) push()
    if (fits(line + piece)) {
      line += piece
      continue
    }

    const word = piece.trimEnd()
    let held = !bare()
    for (const letter of word) {
      if (held && !fits(line + letter)) push()
      line += letter
      held = true
    }
    line += piece.slice(word.length)
  }

  if (line.trimEnd() !== '' || out.length === 0) push()

  return out
}

const already = new Map<string, readonly string[]>()
const MOST_KEPT = 8000

export function wrap(text: string, inner: number, hang = ''): readonly string[] {
  const key = `${String(inner)}\n${hang}\n${text}`
  const known = already.get(key)
  if (known) {
    work.cached += 1
    return known
  }

  work.broken += 1
  const rows = text.includes('\n')
    ? text.split('\n').flatMap((part) => broken(part, inner, hang))
    : broken(text, inner, hang)

  if (already.size >= MOST_KEPT) already.clear()
  already.set(key, rows)

  return rows
}

export function rows(text: string, inner: number, hang = ''): number {
  return wrap(text, inner, hang).length
}

export function fit(text: string, most: number): string {
  const whole = fold(text)
  if (measure(whole) <= most) return whole

  const room = most - measure('…')
  if (room <= 0) return ''

  let taken = ''
  for (const one of whole) {
    if (measure(taken + one) > room) break
    taken += one
  }

  return `${taken.trimEnd()}…`
}

export const SPACE = getAdvW(0x20) / 16

export function rightward(text: string, inner: number): string {
  const whole = fold(text)
  let gap = Math.floor((inner - measure(whole)) / SPACE)

  while (gap > 0 && measure(' '.repeat(gap) + whole) > inner) gap--

  return gap > 0 ? ' '.repeat(gap) + whole : whole
}

export function spread(left: string, right: string, inner: number): string {
  const end = fold(right)
  const room = inner - measure(end) - SPACE * 2
  const start = fit(left, Math.max(0, room))
  const gap = Math.floor((inner - measure(start) - measure(end)) / SPACE)

  return start + ' '.repeat(Math.max(1, gap)) + end
}

export function ruleOf(glyph: string, inner: number): string {
  const one = width(glyph)
  if (one <= 0) return ''

  return glyph.repeat(Math.max(1, Math.floor(inner / one)))
}
