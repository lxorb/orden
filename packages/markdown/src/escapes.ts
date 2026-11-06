import { codeAndWords, PUNCTUATION } from './tags'
import { OPENS_MARKUP } from './words'

function bracketsOf(text: string): string {
  return text.replace(OPENS_MARKUP, '\\<')
}

const WORD = /[\p{L}\p{N}]/u

const BLANK = /\s/

const A_BLOCK = /^(?:-(?=[\s-]|$)|\+ |>|~~~|=+|#{1,6} )/

const A_NUMBER = /^(\d+)([.)]) /

const A_CODE_SPAN = /(`{1,3})([^`]+)\1(?!`)/y

const A_STRONG = /(\*\*|__)([^`*_[\]\\<%$=]+)\1/y

const A_URL = /(?:(?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/|www\.)(?:[a-zA-Z0-9-]+\.?)+[^\s<]*/y

const TRAILING = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/

const AN_ADDRESS = /[hHfFw]/

function addressAt(text: string, at: number): string | null {
  if (!AN_ADDRESS.test(text[at] ?? '')) return null
  A_URL.lastIndex = at
  let address = A_URL.exec(text)?.[0]
  if (!address) return null

  for (let before = ''; before !== address;) {
    before = address
    address = TRAILING.exec(address)?.[0] ?? ''
  }
  return address && !address.includes('%%') ? address : null
}

function unmistakable(text: string, at: number, found: RegExpExecArray): boolean {
  const run = found[0]
  const marker = run[0]
  const inside = found[2] ?? ''

  if (text[at - 1] === marker || text[at + run.length] === marker) return false
  return !BLANK.test(inside[0] ?? ' ') && !BLANK.test(inside.at(-1) ?? ' ')
}

const A_RUN = /[`*_]/

function keptAt(text: string, at: number): string | null {
  if (!A_RUN.test(text[at] ?? '')) return null

  for (const pattern of [A_CODE_SPAN, A_STRONG]) {
    pattern.lastIndex = at
    const found = pattern.exec(text)
    if (found && unmistakable(text, at, found)) return found[0]
  }

  return null
}

function isWord(one: string | undefined): boolean {
  return one !== undefined && WORD.test(one)
}

function isBlank(one: string | undefined): boolean {
  return one !== undefined && BLANK.test(one)
}

function escapeAt(text: string, at: number, midLine: boolean): string {
  const one = text[at] ?? ''
  const before = text[at - 1]
  const after = text[at + 1]

  switch (one) {
    case '\\':
      return after === undefined || PUNCTUATION.test(after) ? '\\\\' : '\\'
    case '_':
      return isWord(before) && isWord(after) ? '_' : '\\_'
    case '*':
      return midLine && isBlank(before) && isBlank(after) ? '*' : '\\*'
    case '~':
    case '^':
      return isBlank(after) ? one : `\\${one}`
    case '%':
      return before === '%' ? '\\%' : '%'
    case '=':
      return before === '=' ? '\\=' : '='
    case '$':
      return isBlank(before) && isBlank(after) ? '$' : '\\$'
    case '`':
    case '[':
    case ']':
      return `\\${one}`
    default:
      return one
  }
}

export function escapeText(
  text: string,
  { addresses = false }: { addresses?: boolean } = {},
): string {
  const out: string[] = []
  const numbered = A_NUMBER.exec(text)
  const block = numbered ? null : A_BLOCK.exec(text)

  let escaped = numbered ? `${numbered[1]}\\${numbered[2]} ` : block ? `\\${block[0]}` : ''
  let at = (numbered?.[0] ?? block?.[0] ?? '').length
  let midLine = at > 0

  while (at < text.length) {
    const address = addressAt(text, at)

    if (address && !addresses) {
      for (const end = at + address.length; at < end; at++) {
        escaped += escapeAt(text, at, midLine)
      }
      midLine = true
      continue
    }

    if (address) {
      out.push(bracketsOf(escaped + address).slice(0, -address.length))
      out.push(address.replace(/[[\]`]/g, '\\$&'))
      escaped = ''
      at += address.length
      midLine = true
      continue
    }

    const kept = keptAt(text, at)

    if (kept) {
      out.push(bracketsOf(escaped), kept)
      escaped = ''
      at += kept.length
      midLine = true
      continue
    }

    escaped += escapeAt(text, at, midLine)
    midLine ||= !isBlank(text[at])
    at += 1
  }

  out.push(bracketsOf(escaped))
  return out.join('')
}

const A_LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/

export function plainWords(text: string): string {
  let listOpen = false
  let blankBefore = true
  return text
    .split('\n')
    .map((line) => {
      const indent = /^[ \t]*/.exec(line)?.[0] ?? ''
      const deep = columnsOf(indent) >= 4
      const blank = !line.trim()
      const marker = A_LIST_ITEM.exec(line)?.[0]
      const wasBlank = blankBefore
      blankBefore = blank
      if (marker && (!deep || listOpen)) {
        listOpen = true
        return marker + escapeText(line.slice(marker.length), { addresses: true })
      }

      if (!blank) listOpen &&= !wasBlank || indent.length > 0
      const words = escapeText(line.slice(indent.length), { addresses: true })
      return (deep && !listOpen ? NO_BREAK.repeat(columnsOf(indent)) : indent) + words
    })
    .join('\n')
}

const NO_BREAK = '\u00a0'

function columnsOf(indent: string): number {
  let columns = 0
  for (const one of indent) columns = one === '\t' ? columns + 4 - (columns % 4) : columns + 1
  return columns
}

const AN_ESCAPE = /\\([!-/:-@[-`{-~])/g

export function shownWords(text: string): string {
  return codeAndWords(text)
    .map((one) => (one.code ? one.text : one.text.replace(AN_ESCAPE, '$1')))
    .join('')
}

export function unescapedAt(text: string): number[] {
  const out: number[] = []
  let at = 0
  for (const one of codeAndWords(text)) {
    if (one.code) {
      at += one.text.length
      continue
    }
    let taken = 0
    for (const found of one.text.matchAll(AN_ESCAPE)) {
      out.push(at + found.index - taken)
      taken++
    }
    at += one.text.length - taken
  }
  return out
}

export function typedWords(text: string): string {
  return typedChars(text).join('')
}

function typedChars(text: string): string[] {
  return codeAndWords(text).flatMap((one) => {
    const words = one.text
    if (one.code) return words.split('')
    const out: string[] = []
    for (let at = 0; at < words.length; at++) {
      const char = words.charAt(at)
      const before = words[at - 1]
      const after = words[at + 1]
      const escaped =
        (char === '\\' && after !== undefined && PUNCTUATION.test(after)) ||
        (char === '$' && !(isBlank(before) && isBlank(after))) ||
        ((char === '~' || char === '^') && !isBlank(after)) ||
        ((char === '%' || char === '=') && before === char) ||
        (char === '<' && /[A-Za-z/!?]/.test(after ?? ''))
      out.push(escaped ? `\\${char}` : char)
    }
    return out
  })
}

function shownChars(text: string): { shown: string; written: string }[] {
  return codeAndWords(text).flatMap((one) => {
    const out: { shown: string; written: string }[] = []
    for (let at = 0; at < one.text.length; at++) {
      const char = one.text.charAt(at)
      const next = one.text.charAt(at + 1)
      if (!one.code && char === '\\' && PUNCTUATION.test(next)) {
        out.push({ shown: next, written: `\\${next}` })
        at += 1
      } else out.push({ shown: char, written: char })
    }
    return out
  })
}

export function editedWords(line: string, edited: string): string {
  const was = shownChars(line)
  const shown = was.map((one) => one.shown).join('')
  if (edited === shown) return line

  let head = 0
  const most = Math.min(shown.length, edited.length)
  while (head < most && shown[head] === edited[head]) head++
  let tail = 0
  while (tail < most - head && shown[shown.length - 1 - tail] === edited[edited.length - 1 - tail])
    tail++

  const typed = typedChars(edited)
  const written = (keepHead: number, keepTail: number) => {
    const out: string[] = []
    for (let at = 0; at < edited.length; at++) {
      if (at < keepHead) out.push(was[at]?.written ?? '')
      else if (at >= edited.length - keepTail)
        out.push(was[shown.length - (edited.length - at)]?.written ?? '')
      else out.push(typed[at] ?? '')
    }
    return out.join('')
  }

  for (const [keepHead, keepTail] of [
    [head, tail],
    [head, 0],
    [0, tail],
  ] as const) {
    const out = written(keepHead, keepTail)
    if (shownWords(out) === edited) return out
  }
  return typedWords(edited)
}

const HELD = 0xe000

export function heldEscapes(text: string): string {
  return codeAndWords(text)
    .map((one) =>
      one.code
        ? one.text
        : one.text.replace(AN_ESCAPE, (_, char: string) =>
            String.fromCharCode(HELD + char.charCodeAt(0)),
          ),
    )
    .join('')
}

export function released(text: string, asWritten = false): string {
  return text.replace(/[-]/g, (one) => {
    const char = String.fromCharCode(one.charCodeAt(0) - HELD)
    return asWritten ? `\\${char}` : char
  })
}
