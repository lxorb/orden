export interface Span {
  from: number
  to: number
}

const DEEPEST = 512

const QUOTE = 0x22
const BACKSLASH = 0x5c
const COLON = 0x3a
const COMMA = 0x2c
const OPEN_BRACE = 0x7b
const CLOSE_BRACE = 0x7d
const OPEN_BRACKET = 0x5b
const CLOSE_BRACKET = 0x5d

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09
}

function skipSpace(text: string, at: number, end: number): number {
  let one = at
  while (one < end && isSpace(text.charCodeAt(one))) one++
  return one
}

function pastString(text: string, at: number, end: number): number {
  let close = text.indexOf('"', at + 1)

  while (close >= 0 && close < end) {
    let slashes = 0
    while (text.charCodeAt(close - 1 - slashes) === BACKSLASH) slashes++
    if (slashes % 2 === 0) return close + 1
    close = text.indexOf('"', close + 1)
  }

  return -1
}

function pastContainer(text: string, at: number, end: number): number {
  const next = (mark: string, from: number) => {
    const found = text.indexOf(mark, from)
    return found < 0 || found >= end ? end : found
  }

  const owed: number[] = []
  let quote = next('"', at)
  let openBrace = next('{', at)
  let closeBrace = next('}', at)
  let openBracket = next('[', at)
  let closeBracket = next(']', at)

  for (;;) {
    const one = Math.min(quote, openBrace, closeBrace, openBracket, closeBracket)
    if (one >= end) return -1

    if (one === quote) {
      const past = pastString(text, one, end)
      if (past < 0) return -1

      quote = next('"', past)
      if (openBrace < past) openBrace = next('{', past)
      if (closeBrace < past) closeBrace = next('}', past)
      if (openBracket < past) openBracket = next('[', past)
      if (closeBracket < past) closeBracket = next(']', past)
    } else if (one === openBrace || one === openBracket) {
      if (owed.length >= DEEPEST) return -1

      if (one === openBrace) {
        owed.push(CLOSE_BRACE)
        openBrace = next('{', one + 1)
      } else {
        owed.push(CLOSE_BRACKET)
        openBracket = next('[', one + 1)
      }
    } else {
      const closer = one === closeBrace ? CLOSE_BRACE : CLOSE_BRACKET
      if (owed.pop() !== closer) return -1
      if (!owed.length) return one + 1

      if (closer === CLOSE_BRACE) closeBrace = next('}', one + 1)
      else closeBracket = next(']', one + 1)
    }
  }
}

function pastValue(text: string, at: number, end: number): number {
  const code = text.charCodeAt(at)
  if (code === QUOTE) return pastString(text, at, end)
  if (code === OPEN_BRACE || code === OPEN_BRACKET) return pastContainer(text, at, end)

  let one = at
  while (one < end) {
    const next = text.charCodeAt(one)
    if (next === COMMA || next === CLOSE_BRACE || next === CLOSE_BRACKET || isSpace(next)) break
    one++
  }

  return one > at ? one : -1
}

export interface Order {
  ahead?: readonly string[]
  last?: string
}

export function skim(
  text: string,
  keys: readonly string[],
  within: Span = { from: 0, to: text.length },
  order: Order = {},
): Map<string, Span> | null {
  const end = within.to
  let at = skipSpace(text, within.from, end)
  if (text.charCodeAt(at) !== OPEN_BRACE) return null

  const found = new Map<string, Span>()
  at = skipSpace(text, at + 1, end)
  if (text.charCodeAt(at) === CLOSE_BRACE) return found

  let ahead: readonly string[] | null = null
  for (let first = true; ; first = false) {
    if (text.charCodeAt(at) !== QUOTE) return null
    const named = pastString(text, at, end)
    if (named < 0) return null

    const raw = text.slice(at + 1, named - 1)
    const key = raw.includes('\\') ? String(JSON.parse(text.slice(at, named)) as unknown) : raw

    if (first && order.ahead?.[0] === key) ahead = order.ahead
    if (ahead && !ahead.includes(key)) return found

    at = skipSpace(text, named, end)
    if (text.charCodeAt(at) !== COLON) return null

    const from = skipSpace(text, at + 1, end)
    if (key === order.last && keys.every((one) => one === key || found.has(one))) {
      found.set(key, { from, to: end })
      return found
    }

    const to = pastValue(text, from, end)
    if (to < 0) return null
    if (keys.includes(key)) found.set(key, { from, to })

    at = skipSpace(text, to, end)
    const next = text.charCodeAt(at)
    if (next === CLOSE_BRACE) return found
    if (next !== COMMA) return null
    at = skipSpace(text, at + 1, end)
  }
}
