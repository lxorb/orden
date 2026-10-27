/** Where a fenced code block opens and closes.
 *
 *  Four things in this package walk a note line by line and have to step over
 *  code: the comment stripper, the abbreviation collector, the deck's break
 *  scanner and the link scanner. Each carried its own pattern and its own idea of
 *  what closes a fence, and they did not agree - so a note whose fences were
 *  written in a way one of them misread had its comments stripped inside code, or
 *  taught itself an abbreviation it was only showing. One reading, here.
 *
 *  `fenceMark` and `closesFence` are not markdown's whole grammar for a fence: a
 *  fence inside a blockquote or a list item carries a prefix, which they do not
 *  unwrap. What they answer is the question the deck's break scanner and the
 *  editor ask - does this line open or close a block of code - and they answer
 *  it the same way for all of them.
 *
 *  A reader that has to agree with the page about what is code asks `CodeBlocks`
 *  at the end of this file instead, which keeps the quotes and list items a line
 *  sits in: the comment stripper, the abbreviation collector and the link
 *  scanner, and the tag and task walks outside this package. */

/** Up to three spaces of indent, as CommonMark allows before an indented code
 *  block takes over; then the run of marks; then the info string, in which a
 *  backtick fence has no backtick (CommonMark 4.5). */
const FENCE = /^ {0,3}(`{3,}(?!.*`)|~{3,})[ \t]*(\S*)/

/** Whether a line could be a fence at all: a mark, after up to three spaces.
 *
 *  A byte or two instead of the pattern. Every walk below is asked about every
 *  line of the note - on every render, and in the editor on every keystroke -
 *  and nearly every line it is asked about is prose. */
function couldBeFence(line: string): boolean {
  let at = 0
  while (at < 3 && line[at] === ' ') at++

  const mark = line[at]
  return mark === '`' || mark === '~'
}

/** The run of backticks or tildes a fence line carries, or null for a line that
 *  is not a fence at all. The run itself, because how long it is and which
 *  character it is made of are both what closes it. */
export function fenceMark(line: string): string | null {
  if (!couldBeFence(line)) return null
  return FENCE.exec(line)?.[1] ?? null
}

/** Whether a line closes the fence `mark` opened: the same character, at least as
 *  many of them, and nothing after them.
 *
 *  The last of the three is the one that is easy to forget. CommonMark allows an
 *  info string only on the line that opens a block, so ```` ```ts ```` inside a
 *  block is code being shown rather than the end of the block showing it. */
export function closesFence(line: string, mark: string): boolean {
  if (!couldBeFence(line)) return false

  const found = FENCE.exec(line)
  if (!found) return false

  const run = found[1] ?? ''
  return run.startsWith(mark.charAt(0)) && run.length >= mark.length && !found[2]
}

/** Where a span of `length` backticks closes after `from`, or -1: at a run of
 *  exactly that many, as a longer one is inside it. */
export function closingTicks(line: string, from: number, length: number): number {
  const run = new RegExp(`(?<!\`)\`{${length}}(?!\`)`, 'g')
  run.lastIndex = from
  return run.exec(line)?.index ?? -1
}

/** Which lines of a note are code, judged the way the renderer judges them.
 *
 *  A fence inside a quote or a callout carries `> ` in front of it, one inside a
 *  list item is indented under the item, and a line indented by four spaces after
 *  a blank line is code with no fence at all. The renderer (marked, which follows
 *  CommonMark here) draws all of those as `<pre>`, so a tag or a comment marker in
 *  them is what the code says, not something to read.
 *
 *  So this walks the note a line at a time and keeps the containers a line sits
 *  in, quotes and list items, the way CommonMark's block parse does: it takes off
 *  the markers a line continues them with, and judges what is left. Not the whole
 *  grammar: HTML blocks, tables and link definitions are words to it, which is
 *  what they are to every reader that asks this. The Rust twin is
 *  src-tauri/src/code_blocks.rs, and the tests hold the two to the same answers. */

/** A line of words: a paragraph's, a heading's, a blank one. */
export const WORDS = 0
/** A line of code, or a fence that closes some. */
export const CODE = 1
/** A fence that opens code. Its info string is words to a reader that keeps
 *  them, which is why it is told apart from the code under it. */
export const OPENS = 2

export type CodeLine = typeof WORDS | typeof CODE | typeof OPENS

/** A quote, or a list item whose content starts `width` columns in. */
type Container = { quote: true } | { quote: false; width: number }

/** What the innermost container holds open: a paragraph, which a line of words
 *  can carry on lazily; a fence, until its closing mark; or indented code. */
type Leaf = null | 'paragraph' | 'indented' | { mark: string }

/** A list marker, the spaces after it, and whether anything follows them. */
const MARKER = /^([-*+]|(\d{1,9})[.)])( *)(.?)/

/** A thematic break, which looks like a list item to `MARKER` and is none. */
const BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/

const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/

/** The columns a tab stands for, as CommonMark counts them. */
function expanded(line: string): string {
  if (!line.includes('\t')) return line

  let out = ''
  for (const one of line) out += one === '\t' ? ' '.repeat(4 - (out.length % 4)) : one
  return out
}

/** How many spaces stand in a row from `at`. */
function spacesAt(line: string, at: number): number {
  let over = 0
  while (line.charAt(at + over) === ' ') over++
  return over
}

/** Feed it a note's lines in order; it says of each what it is. */
export class CodeBlocks {
  private containers: Container[] = []
  private leaf: Leaf = null

  /** A walk that has read what this one has, to go on from here apart from it. */
  copy(): CodeBlocks {
    const copy = new CodeBlocks()
    copy.containers = [...this.containers]
    copy.leaf = this.leaf
    return copy
  }

  /** The mark of the fence that is open, or null outside one. */
  get fence(): string | null {
    return this.leaf !== null && typeof this.leaf === 'object' ? this.leaf.mark : null
  }

  line(raw: string): CodeLine {
    // A line break written as CRLF leaves its `\r` on a line split at `\n`.
    const line = expanded(raw.endsWith('\r') ? raw.slice(0, -1) : raw)
    let at = 0
    let matched = 0

    // The containers this line carries on: a quote by its `>`, an item by its
    // indent, or by being blank.
    for (const container of this.containers) {
      const indent = spacesAt(line, at)
      if (container.quote) {
        if (indent > 3 || line.charAt(at + indent) !== '>') break
        at += indent + 1
        if (line.charAt(at) === ' ') at++
      } else if (line.slice(at).trim() === '') {
        at = line.length
      } else if (indent >= container.width) {
        at += container.width
      } else {
        break
      }
      matched++
    }

    const rest = line.slice(at)

    if (matched < this.containers.length) {
      // A paragraph carries on over a line that opens nothing, whatever it left
      // out: CommonMark's lazy continuation.
      if (this.leaf === 'paragraph' && rest.trim() !== '' && !this.opensBlock(rest)) return WORDS
      this.containers.length = matched
      this.leaf = null
    }

    if (this.leaf !== null && typeof this.leaf === 'object') {
      if (closesFence(rest, this.leaf.mark)) this.leaf = null
      return CODE
    }

    if (this.leaf === 'indented') {
      if (rest.trim() === '' || spacesAt(rest, 0) >= 4) return CODE
      this.leaf = null
    }

    return this.open(rest)
  }

  /** Whether `rest` opens a block of its own rather than carrying a paragraph on. */
  private opensBlock(rest: string): boolean {
    const indent = spacesAt(rest, 0)
    if (indent > 3) return false

    const text = rest.slice(indent)
    return (
      text.startsWith('>') ||
      fenceMark(rest) !== null ||
      HEADING.test(rest) ||
      BREAK.test(rest) ||
      // Not the rule for breaking into a paragraph: the paragraph is inside the
      // containers this line left, so any marker opens an item beside them.
      this.marker(text, false) !== null
    )
  }

  /** How wide a list marker at the start of `text` is, its spaces included, or
   *  null when there is none. One that would break into a paragraph has to have
   *  words after it, and be a bullet or a `1`. */
  private marker(text: string, interrupting: boolean): number | null {
    const found = MARKER.exec(text)
    if (!found) return null

    const [, mark = '', number, spaces = '', next = ''] = found
    if (spaces === '' && next !== '') return null
    if (interrupting && (next === '' || (number !== undefined && Number(number) !== 1))) return null

    // Nothing after the marker, or code after it: the content starts one past it.
    if (next === '' || spaces.length > 4) return mark.length + 1
    return mark.length + spaces.length
  }

  /** The containers `rest` opens, and then what is in them. */
  private open(start: string): CodeLine {
    let rest = start

    for (;;) {
      const indent = spacesAt(rest, 0)
      if (indent > 3) break
      const text = rest.slice(indent)

      if (text.startsWith('>')) {
        this.containers.push({ quote: true })
        this.leaf = null
        rest = text.slice(text.charAt(1) === ' ' ? 2 : 1)
        continue
      }

      if (BREAK.test(rest)) break
      const width = this.marker(text, this.leaf === 'paragraph')
      if (width === null) break

      this.containers.push({ quote: false, width: indent + width })
      this.leaf = null
      rest = text.length > width ? text.slice(width) : ''
    }

    if (rest.trim() === '') {
      this.leaf = null
      return WORDS
    }

    if (spacesAt(rest, 0) >= 4) {
      if (this.leaf === 'paragraph') return WORDS
      this.leaf = 'indented'
      return CODE
    }

    const mark = fenceMark(rest)
    if (mark !== null) {
      this.leaf = { mark }
      return OPENS
    }

    this.leaf = HEADING.test(rest) || BREAK.test(rest) ? null : 'paragraph'
    return WORDS
  }
}
