const FENCE = /^---[ \t]*$/

const MOST_KEY_WORDS = 6
const MOST_KEY_CHARACTERS = 80

const SENTENCE_KEY_WORDS = 3
const SENTENCE_VALUE_WORDS = 3

const MOST_KEY_LENGTH = 1024

const NOT_A_KEY = '#*>|[]{}!&%@`,'

const NOT_THE_FIRST_KEY = /^(?:[-+][ \t]|\d+[.)][ \t]|<[a-zA-Z/!?])/

const TIGHT_KEY = /^[A-Za-z_][\w.$-]*:(?!\/\/)[^\s:]/

interface Open {
  quote: string
  depth: number
}

function isBlank(one: string | undefined): boolean {
  return one === ' ' || one === '\t'
}

function wordsIn(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length
}

export function isKeyLine(text: string): boolean {
  const past = pastKey(text, 0)
  if (past === -1) return TIGHT_KEY.test(text)
  if (NOT_THE_FIRST_KEY.test(text) || past === 1) return false
  if (text.startsWith('"') || text.startsWith("'")) return true

  const key = text.slice(0, past - 1).trimEnd()
  if (key.includes('://') || Array.from(key).length > MOST_KEY_CHARACTERS) return false
  const words = wordsIn(key)
  if (words > MOST_KEY_WORDS) return false

  const value = text.slice(past).trim()
  return !(
    words >= SENTENCE_KEY_WORDS &&
    wordsIn(value) >= SENTENCE_VALUE_WORDS &&
    /[.!?…]$/u.test(value)
  )
}

function pastQuote(line: string, at: number): number {
  const quote = line[at]
  for (let over = at + 1; over < line.length; over++) {
    if (quote === '"' && line[over] === '\\') over++
    else if (line[over] === quote) {
      if (quote === "'" && line[over + 1] === "'") over++
      else return over + 1
    }
  }
  return -1
}

function pastKey(line: string, at: number): number {
  const first = line.charAt(at)
  if (first === '' || NOT_A_KEY.includes(first)) return -1

  let from = at
  if (first === '"' || first === "'") {
    from = pastQuote(line, at)
    if (from === -1) return -1
    while (isBlank(line[from])) from++
    if (line[from] !== ':') return -1
  }

  for (let colon = line.indexOf(':', from); colon !== -1; colon = line.indexOf(':', colon + 1)) {
    if (colon - at > MOST_KEY_LENGTH) return -1
    if (colon + 1 === line.length || isBlank(line[colon + 1])) return colon + 1
  }
  return -1
}

function staysOpen(line: string, open: Open): boolean {
  let starts = true
  for (let at = 0; at < line.length; at++) {
    const one = line[at]
    if (open.quote === '"' || open.quote === "'") {
      if (open.quote === '"' && one === '\\') at++
      else if (one === open.quote) {
        if (open.quote === "'" && line[at + 1] === "'") at++
        else {
          open.quote = ''
          if (open.depth === 0) return false
          starts = false
        }
      }
      continue
    }

    if (one === '#' && (at === 0 || isBlank(line[at - 1]))) return true
    if ((one === '"' || one === "'") && starts) open.quote = one
    else if (one === '[' || one === '{') {
      open.depth++
      starts = true
    } else if (one === ']' || one === '}') {
      open.depth--
      if (open.depth <= 0) return false
      starts = false
    } else if (one === ',' || one === ':') starts = true
    else if (!isBlank(one)) starts = false
  }
  return true
}

const BLOCK_SCALAR = /^[|>][-+0-9]*[ \t]*(?:#.*)?$/

const PROPERTIES = /^(?:[&!][^ \t]*(?:[ \t]+|$))+/

export function valueClosesAt(source: string, from: number, limit: number): number {
  const lineEnd = (at: number) => {
    const end = source.indexOf('\n', at)
    return end === -1 || end > limit ? limit : end
  }

  let stop = lineEnd(from)
  const said = source.slice(from, stop).trimStart().replace(PROPERTIES, '')
  if (!/^["'[{]/.test(said)) return -1
  const open: Open = { quote: '', depth: 0 }
  if (!staysOpen(said.replace(/\r$/, ''), open)) return -1

  while (stop + 1 < limit) {
    const at = stop + 1
    stop = lineEnd(at)
    if (!staysOpen(source.slice(at, stop).replace(/\r$/, ''), open)) return stop
  }
  return -1
}

function closingFence(source: string, from: number): number {
  let base = -1
  let comment = false
  let list = false
  let gap = false
  let scalar = -1
  let open: Open | null = null
  let whole = false
  let opens = true
  let reread = 0

  for (let at = from; at <= source.length;) {
    const end = source.indexOf('\n', at)
    const stop = end === -1 ? source.length : end
    const line = source.slice(at, source[stop - 1] === '\r' && stop > at ? stop - 1 : stop)

    if (FENCE.test(line)) {
      if (!open) return base < 0 && comment ? -1 : at
      open = null
      opens = false
      at = reread
      continue
    }

    if (open) {
      if (!staysOpen(line, open)) open = null
    } else {
      let indent = 0
      while (isBlank(line[indent])) indent++

      if (indent === line.length) gap = true
      else if (!(scalar >= 0 && indent > scalar)) {
        scalar = -1

        if (line[indent] === '#') comment = true
        else if (whole) return -1
        else {
          const first = base < 0
          if (first) {
            const text = line.slice(indent)
            if (!isKeyLine(text) && !/^(?:\?(?:[ \t]|$)|\{)/.test(text)) return -1
            base = indent
          }

          let col = indent
          let dash = -1
          while (line[col] === '-' && (col + 1 === line.length || isBlank(line[col + 1]))) {
            dash = col
            col++
            while (isBlank(line[col])) col++
          }

          const complex =
            (line[col] === '?' || line[col] === ':') &&
            (col + 1 === line.length || isBlank(line[col + 1]))
          const past = complex ? col + 1 : pastKey(line, col)
          const keyed = past !== -1 || TIGHT_KEY.test(line.slice(col))
          const continues = indent > base || (dash >= 0 && list)
          if (gap && !keyed && !continues) return -1
          gap = false

          let value = past !== -1 ? past : col
          while (isBlank(line[value])) value++
          const said = line.slice(value).replace(PROPERTIES, '')
          const start = said.charAt(0)
          const empty = said === '' || start === '#'

          if (indent === base && dash < 0) list = empty
          whole = first && start === '{' && past === -1

          const asValue = past !== -1 || dash >= 0 || indent > base || whole
          if (BLOCK_SCALAR.test(said)) scalar = past !== -1 ? col : dash >= 0 ? dash : indent
          else if (
            opens &&
            asValue &&
            (start === '"' || start === "'" || start === '[' || start === '{')
          ) {
            const opening: Open = { quote: '', depth: 0 }
            if (staysOpen(said, opening)) {
              open = opening
              reread = stop + 1
            }
          } else if (!empty) scalar = past !== -1 ? col : dash >= 0 ? dash : indent - 1
        }
      }
    }

    if (end === -1) return -1
    at = end + 1
  }
  return -1
}

export function frontMatterLines(
  source: string,
): { from: number; body: number; close: number } | null {
  const from = source.startsWith('﻿') ? 1 : 0
  if (!source.startsWith('---', from)) return null

  const first = source.indexOf('\n')
  if (first === -1) return null
  const opening = source.slice(from, source[first - 1] === '\r' ? first - 1 : first)
  if (!FENCE.test(opening)) return null

  const close = closingFence(source, first + 1)
  return close === -1 ? null : { from, body: first + 1, close }
}
