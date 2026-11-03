/** Whether a note's opening `---` is front matter at all: the one definition, which
 *  every reader of a note asks, here and through `frontMatterBlock`.
 *
 *  A block is YAML that reads as a mapping. Every line between the fences has to be a
 *  key of it, what continues one (a value's further lines, a list under its key, a
 *  blank line, a comment), or else the fences are two rules with words between them
 *  and those words are the note's: a reader hiding them loses them, and a writer
 *  adding a key writes into them. Not a YAML parser, which the deck's scan could not
 *  afford on every note, and a line that only YAML itself would refuse (`title: a: b`)
 *  is still a key; what it tells apart is metadata from prose. A file with a first
 *  line of a sentence stays prose however it goes on, because a false no shows a few
 *  keys on the page while a false yes takes somebody's words off it.
 *
 *  A module of its own for the deck's scan, which is asked of every note and does not
 *  want the rest of front-matter.ts. The Rust twin is `block` in
 *  src-tauri/src/front_matter.rs; front-matter-table.json holds the two to the same
 *  answers and front-matter-yaml.test.ts in @orden/bases holds this to the YAML
 *  library. */

/** A fence: at the margin, three hyphens, and nothing else but blanks. An indented one
 *  is a line of a block scalar or an indented rule. */
const FENCE = /^---[ \t]*$/

/** The first line of a block has to say a key rather than merely hold a colon: a word
 *  as the fields of a plugin are named, or a name in anybody's language of a few words,
 *  quoted or not. `Priorität:`, `due date:`, `Size (cm):` and `日期:` are; `- a: b`,
 *  `http://x` and a sentence that has a colon in it are not. */
const PLAIN_KEY = /^[\w.$-]+[ \t]*:(?:[ \t]|$)/
const QUOTED_KEY = /^(?:"[^"]*"|'[^']*')[ \t]*:(?:[ \t]|$)/
const NAMED_KEY = /^([^\s:#\-*+>|[\]{}!&%@`"',.?][^:.,!?;]*?)[ \t]*:(?:[ \t]|$)/u
const MOST_KEY_WORDS = 4

/** YAML's own limit on a key written without a `?`. */
const MOST_KEY_LENGTH = 1024

/** A first character that makes a line a list, a quote or a YAML shape rather than a
 *  key, whatever colon it holds further on. */
const NOT_A_KEY = '#*+>|[]{}!&%@`,'

/** A value that is a block scalar's header, whose lines are the scalar's whatever they
 *  say. */
const BLOCK_SCALAR = /^[|>][-+0-9]*[ \t]*(?:#.*)?$/

/** An anchor or a tag in front of a value. */
const PROPERTIES = /^(?:[&!][^ \t]*(?:[ \t]+|$))+/

/** What a value still has open at the end of its line: a quote, or how deep in brackets. */
interface Open {
  quote: string
  depth: number
}

function isBlank(one: string | undefined): boolean {
  return one === ' ' || one === '\t'
}

function isKeyLine(text: string): boolean {
  if (PLAIN_KEY.test(text) || QUOTED_KEY.test(text)) return true
  const key = NAMED_KEY.exec(text)?.[1]
  return key !== undefined && key.split(/\s+/).length <= MOST_KEY_WORDS
}

/** Past the quote that opens at `at`, or -1 where it does not close on the line. */
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

/** Just past the colon of the key that starts at `at`, or -1 where the line says none. */
function pastKey(line: string, at: number): number {
  const first = line.charAt(at)
  if (NOT_A_KEY.includes(first)) return -1

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

/** Reads a value's text with a quote or a bracket open, and says whether it stays open
 *  past this line. A quote only opens where a value could start: `[don't, x]` holds a
 *  plain word. */
function staysOpen(line: string, from: number, open: Open): boolean {
  let starts = true
  for (let at = from; at < line.length; at++) {
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

/** The line a block's closing fence starts on, walking from `from`, which is just past
 *  the opening one; or -1 where no block closes there or a line of it is no YAML
 *  mapping's. */
function closingFence(source: string, from: number): number {
  /** The indent of the mapping, once its first key is read. */
  let base = -1
  let comment = false
  /** Whether a `- ` at the mapping's own indent belongs to the key above it. */
  let list = false
  /** Lines indented past this are a block scalar's, or a plain value's next lines. */
  let scalar = -1
  let open: Open | null = null
  /** Whether the mapping was written whole as a `{...}`, which nothing can follow. */
  let whole = false
  /** Whether a quote or a bracket holds a value open past its line, and the line after
   *  the one that did. */
  let opens = true
  let reread = 0

  for (let at = from; at <= source.length;) {
    const end = source.indexOf('\n', at)
    const stop = end === -1 ? source.length : end
    const line = source.slice(at, source[stop - 1] === '\r' && stop > at ? stop - 1 : stop)

    if (FENCE.test(line)) {
      if (!open) return base < 0 && comment ? -1 : at
      // Nothing closed that value, so it was one line's words: a note saying
      // `title: "Foo` by hand, or a list being typed. The lines it took are read again,
      // once, which keeps the walk from growing with every value that opens.
      open = null
      opens = false
      at = reread
      continue
    }

    if (open) {
      if (!staysOpen(line, 0, open)) open = null
    } else {
      let indent = 0
      while (isBlank(line[indent])) indent++

      if (indent < line.length && !(scalar >= 0 && indent > scalar)) {
        scalar = -1

        if (line[indent] === '#') comment = true
        else if (whole) return -1
        else {
          const first = base < 0
          if (first) {
            const text = line.slice(indent)
            if (!isKeyLine(text) && !/^(?:\?(?:[ \t]|$)|\{)/.test(text)) return -1
            base = indent
          } else if (indent < base) return -1

          let col = indent
          let dash = -1
          while (line[col] === '-' && (col + 1 === line.length || isBlank(line[col + 1]))) {
            dash = col
            col++
            while (isBlank(line[col])) col++
          }
          const own = indent === base
          if (dash >= 0 && own && !list) return -1

          const complex =
            (line[col] === '?' || line[col] === ':') &&
            (col + 1 === line.length || isBlank(line[col + 1]))
          const past = complex ? col + 1 : pastKey(line, col)
          if (past === -1 && own && dash < 0 && !(first && line[col] === '{')) return -1

          const keyed = past !== -1
          let value = keyed ? past : col
          while (isBlank(line[value])) value++
          const said = line.slice(value).replace(PROPERTIES, '')
          const start = said.charAt(0)
          const empty = said === '' || start === '#'

          if (own && dash < 0) list = empty
          whole = first && start === '{' && !keyed

          if (BLOCK_SCALAR.test(said)) scalar = keyed ? col : dash >= 0 ? dash : indent
          else if (opens && (start === '"' || start === "'" || start === '[' || start === '{')) {
            const opening: Open = { quote: '', depth: 0 }
            if (staysOpen(said, 0, opening)) {
              open = opening
              reread = stop + 1
            }
          } else if (!empty) scalar = keyed ? col : dash >= 0 ? dash : indent - 1
        }
      }
    }

    if (end === -1) return -1
    at = end + 1
  }
  return -1
}

/** Where a note's block sits, as the offsets the readers build on; null where the note
 *  has none. The fence opens past a byte order mark, which is no character of a note's. */
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
