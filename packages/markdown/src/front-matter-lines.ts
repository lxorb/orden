/** Whether a note's opening `---` is front matter at all: the one definition, which
 *  every reader of a note asks, here and through `frontMatterBlock`.
 *
 *  Decided by how the block opens and by its shape, and never by whether every line of
 *  it parses, because somebody is typing in it: a key has no colon yet for the moment
 *  it takes to write one, and a block that stops being one at that moment is drawn
 *  differently, read as empty by whatever an autosave wakes, and written into as if it
 *  were not there. So:
 *
 *    - The first line that is not a comment says a key (`isKeyLine`). That is what tells
 *      metadata from an essay or a deck's first slide under a rule.
 *    - A line directly under what came before is the block's whatever it says.
 *    - A line after a blank line has to be a key or what continues one (indented, a list
 *      under its key, a comment); anything else is somebody's next paragraph, so the
 *      fences are two rules with words between them, and those words are the note's.
 *
 *  Not a YAML parser, which the deck's scan could not afford on every note. A false no
 *  shows a few keys on the page; a false yes takes somebody's words off it. Quotes and
 *  brackets are followed only so that what they hold across lines is not read as lines.
 *
 *  A module of its own for the deck's scan, which is asked of every note and does not
 *  want the rest of front-matter.ts. The Rust twin is `block` in
 *  src-tauri/src/front_matter.rs; front-matter-table.json holds the two to the same
 *  answers and front-matter-yaml.test.ts in @orden/bases holds this to the YAML
 *  library and to what real tools write. */

/** A fence: at the margin, three hyphens, and nothing else but blanks. An indented one
 *  is a line of a block scalar or an indented rule. */
const FENCE = /^---[ \t]*$/

/** How long a key may be and still tell a block from a sentence that has a colon in it:
 *  `Date of the first meeting held` is one. */
const MOST_KEY_WORDS = 6
const MOST_KEY_CHARACTERS = 80

/** From how many words on a key and a value could be a sentence, if it ends like one:
 *  `Note that we ship: on Tuesday, because of all of this.` */
const SENTENCE_KEY_WORDS = 3
const SENTENCE_VALUE_WORDS = 3

/** YAML's own limit on a key written without a `?`. */
const MOST_KEY_LENGTH = 1024

/** A first character that makes a line a quote, a table or a YAML shape rather than a key,
 *  whatever colon it holds further on. A `+` or a `-` only with a blank after it, where
 *  it is a bullet: `+1:` is a key. */
const NOT_A_KEY = '#*>|[]{}!&%@`,'

/** What opens a list item or a piece of HTML on the first line of a note: prose. */
const NOT_THE_FIRST_KEY = /^(?:[-+][ \t]|\d+[.)][ \t]|<[a-zA-Z/!?])/

/** A key written as Obsidian's own source view lets one be typed, with no blank after
 *  its colon: `title:Foo`. A word first, so `12:30` is a time, and no `//` after it, so
 *  an address is an address. */
const TIGHT_KEY = /^[A-Za-z_][\w.$-]*:(?!\/\/)[^\s:]/

/** What a value still has open at the end of its line: a quote, or how deep in brackets. */
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

/** Whether a line says a key, as the first line of a block has to. Liberal, because a
 *  key in anybody's language is anything up to a colon (`Done?`, `No. of pages`,
 *  `og:title`, `日期`), and narrow only about what reads as a sentence: too long before
 *  the colon, or a key of a few words and a value that ends as a sentence does. A quoted
 *  key is never a sentence. */
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

/** A value that is a block scalar's header, whose lines are the scalar's whatever they
 *  say. */
const BLOCK_SCALAR = /^[|>][-+0-9]*[ \t]*(?:#.*)?$/

/** An anchor or a tag in front of a value. */
const PROPERTIES = /^(?:[&!][^ \t]*(?:[ \t]+|$))+/

/** Where a value that starts at `from` and holds a quote or a bracket open past its line
 *  closes: the break at the end of the line that closes it, read before `limit`. -1 where
 *  it closes on its own line, or nothing closes it, which makes it that one line's words,
 *  as the walk below has it. For a reader that takes a value by its lines. */
export function valueClosesAt(source: string, from: number, limit: number): number {
  const lineEnd = (at: number) => {
    const end = source.indexOf('\n', at)
    return end === -1 || end > limit ? limit : end
  }

  let stop = lineEnd(from)
  const said = source.slice(from, stop).trimStart().replace(PROPERTIES, '')
  if (!/^["'[{]/.test(said)) return -1
  const open: Open = { quote: '', depth: 0 }
  if (!staysOpen(said.replace(/\r$/, ''), 0, open)) return -1

  while (stop + 1 < limit) {
    const at = stop + 1
    stop = lineEnd(at)
    if (!staysOpen(source.slice(at, stop).replace(/\r$/, ''), 0, open)) return stop
  }
  return -1
}

/** The line a block's closing fence starts on, walking from `from`, which is just past
 *  the opening one; or -1 where no block closes there, or what is there is no metadata. */
function closingFence(source: string, from: number): number {
  /** The indent of the mapping, once its first key is read. */
  let base = -1
  let comment = false
  /** Whether a `- ` at the mapping's own indent belongs to the key above it. */
  let list = false
  /** Whether a blank line stands between the last line of the block and this one. */
  let gap = false
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
          const own = indent === base

          const complex =
            (line[col] === '?' || line[col] === ':') &&
            (col + 1 === line.length || isBlank(line[col + 1]))
          const past = complex ? col + 1 : pastKey(line, col)
          const keyed = past !== -1 || TIGHT_KEY.test(line.slice(col))
          // What only a line directly under the block may be: words with no colon yet, a
          // list under a value, a line left of the mapping. After a blank line that is
          // the note's next paragraph.
          const continues = indent > base || (dash >= 0 && list)
          if (gap && !keyed && !continues) return -1
          gap = false

          let value = past !== -1 ? past : col
          while (isBlank(line[value])) value++
          const said = line.slice(value).replace(PROPERTIES, '')
          const start = said.charAt(0)
          const empty = said === '' || start === '#'

          if (own && dash < 0) list = empty
          whole = first && start === '{' && past === -1

          // Words with no key are one line's, whatever they start with.
          const asValue = past !== -1 || dash >= 0 || indent > base || whole
          if (BLOCK_SCALAR.test(said)) scalar = past !== -1 ? col : dash >= 0 ? dash : indent
          else if (
            opens &&
            asValue &&
            (start === '"' || start === "'" || start === '[' || start === '{')
          ) {
            const opening: Open = { quote: '', depth: 0 }
            if (staysOpen(said, 0, opening)) {
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
