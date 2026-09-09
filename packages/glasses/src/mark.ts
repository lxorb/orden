/** A note as the lines the firmware will set.
 *
 *  One font, one size, one weight, one slant, a fixed 27 pixel line and no
 *  alignment. So this cannot draw a heading larger, or a keyword in a colour, or
 *  a bold word bolder. What it has instead is the character set - and the
 *  firmware's font turns out to hold the box drawing, the bullets, the blocks,
 *  the superscripts and the arrows, which between them are enough to say what
 *  every construct in a note *is*.
 *
 *  Two rules decide the whole mapping, and they are Emil's:
 *
 *  1. **A mark that only styles words is dropped; a mark that says what
 *     something is, is kept.** Nobody reading a note on a pair of glasses needs
 *     to know that a word was written `**bold**`: the asterisks are noise and
 *     the word is the point. But whether something is *code* changes what it
 *     means, so a fence keeps its ``` lines and inline code keeps its ticks.
 *  2. **Nothing is dropped.** A formula reads as its own source, a table as
 *     aligned columns, a picture as what it was described as, a fence line by
 *     line. Text mode is a choice about speed, not about silence.
 *
 *  Every glyph here was checked against the firmware's own metrics; see
 *  `firmware.ts`, which is also why a fence is written with `‘‘‘` rather than
 *  ``` - the font has no backtick, and three of them drew nothing at all. */

import { lexMarkdown, stripFrontMatter } from '@nib/markdown'
import type { Token, Tokens } from 'marked'
import { fit, fold, ruleOf, SPACE, width } from './firmware'

/** One line of the note, as the container will be given it.
 *
 *  Total rather than optional: a page is cut by reading these in order, and a
 *  field that is sometimes absent is a field every reader has to guess about. */
export interface Line {
  /** What the firmware sets, gutter and page bands aside. */
  text: string
  /** Where in the note this line's own text begins, counted from the first byte
   *  of the file with the front matter included. What the position map, the page
   *  a note was left on and "go to line" all stand on. */
  from: number
  /** The line of the note this is, counting from one. */
  at: number
  /** True when this line must not be parted from the one before it: the body of
   *  a fence from its opening, a table's rows from its head, the first line of a
   *  section from its heading. */
  glued: boolean
  /** The level of the heading this line is, or zero when it is not one. */
  level: number
  /** True when this line is the rule drawn under the heading above it, rather
   *  than a rule the author wrote. The two look alike and are not: one is the
   *  head band's own furniture when that heading opens a page, the other is a
   *  line of the note that must never be dropped. */
  under: boolean
}

/** Which of a note's own markers are drawn on the glasses.
 *
 *  Rule one above says which are worth drawing, and the defaults are that rule.
 *  This is the reader overruling it, per construct: somebody proof-reading their
 *  own markdown wants to see the asterisks, and somebody reading a note does not.
 *  A switch each rather than one "show markdown" switch, because the answer is
 *  different for a fence and for a bold word and that difference is the rule. */
export interface Marks {
  /** The `#` in front of a heading. Off: the capitals say what it is. */
  heading: boolean
  bold: boolean
  italic: boolean
  strike: boolean
  highlight: boolean
  /** The backticks around inline code. On: whether something is code changes
   *  what it means. */
  code: boolean
  /** The ``` lines around a fence. On, for the same reason. */
  fence: boolean
  /** The brackets and the address of a link. Off: the words it shows are what
   *  there is to read. */
  link: boolean
}

/** What a note shows with nobody having said otherwise: code marked, style marks
 *  dropped, headings without their hashes. Emil's rule, as a value. */
export const MARKS: Marks = {
  heading: false,
  bold: false,
  italic: false,
  strike: false,
  highlight: false,
  code: true,
  fence: true,
  link: false,
}

/** How much of a note's own white space reaches the panel.
 *
 *  Seven lines is not many, and how they are spent is a real choice rather than a
 *  detail. Emil's three, in his words:
 *
 *  - `none` shows every line break as written, even ten in a row;
 *  - `collapse` folds runs of blank lines into one break, so A, blank, blank, B
 *    shows A then B on the next line, while A, newline, B keeps two lines;
 *  - `aggressive` joins A, newline, B into one line, and only two or more
 *    newlines start a new line.
 *
 *  Whatever the level, **a line number is the line of the file**. That is the
 *  point of the numbers: a row that says 12 is line 12 of the note, whether ten
 *  lines were folded into it or none were. */
export type Compaction = 'none' | 'collapse' | 'aggressive'

export const COMPACTIONS: readonly Compaction[] = ['none', 'collapse', 'aggressive']

/** What a reader who has never chosen gets: `collapse`, which is Emil's answer
 *  having read on a pair.
 *
 *  It was `aggressive`, which is what the plugin did before there was a choice at
 *  all. Said once, here, and read by the mapping, by the schema's own initial and by
 *  the store's default, so the three cannot drift; a device that has already saved a
 *  value keeps whatever it saved. */
export const DEFAULT_COMPACTION: Compaction = 'collapse'

export function isCompaction(value: unknown): value is Compaction {
  return typeof value === 'string' && (COMPACTIONS as readonly string[]).includes(value)
}

export interface MarkOptions {
  /** How wide the body is, in pixels. Rules reach exactly this far and a table's
   *  columns are fitted into it. */
  inner: number
  /** Which markers to draw. The defaults above when nobody has said. */
  marks?: Marks
  /** How much white space reaches the panel. `DEFAULT_COMPACTION` when nobody has
   *  said, which is `collapse`. */
  compaction?: Compaction
  /** Whether the first level of a note is indented at all.
   *
   *  Emil: "indentation is not forbidden, but not at the root level, that wastes
   *  space." A list at the root of a note starts at the margin and its own nesting
   *  still steps in; 560 pixels is not enough to spend fifteen of them saying
   *  "this is the top". */
  rootIndent?: boolean
}

/** How far one step of list nesting pushes a line in.
 *
 *  Three spaces, which is fifteen pixels: the width of a bullet and the space
 *  after it, so a nested list and a paragraph under an item both begin exactly
 *  under the words of the item above them. Fifteen pixels of the 560 the body
 *  has, so three levels deep still leaves a full measure of prose. */
const STEP = '   '

/** The bar down the left of a quote. One per level of nesting, as the app draws
 *  them, and the same glyph a table's rule is made of. */
const QUOTE = '│ '

/** What stands in front of a list item.
 *
 *  Three levels of bullet and then the smallest one repeats: a note nested four
 *  deep has other problems. The ballot boxes the rest of the world writes a task
 *  with are not in the firmware font, so a task is a box that is filled or not. */
const BULLETS = ['•', '·', '-'] as const
const TASK_OPEN = '□'
const TASK_DONE = '■'

/** The mark in front of a picture, which is the one block that cannot be what it
 *  is. A square with lines in it, which the font has. */
const PICTURE = '▤'

/** What a fence is written with. Three left quotes, because the firmware has no
 *  backtick and a left quote is the same stroke; see `firmware.ts`. */
const FENCE = '```'

/** The digits a superscript and a subscript are set in.
 *
 *  The firmware has all ten of each, and nothing else: no superscript letters,
 *  no superscript signs. So `^2^` is `²` and `^n^` is `n`, which is the honest
 *  answer rather than a guess. */
const SUPERS = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const SUBS = '₀₁₂₃₄₅₆₇₈₉'

/** What a line's own furniture is: the quote bars it opens with, its
 *  indentation, and its marker.
 *
 *  Written next to the glyphs it matches, because the two have to agree: a bullet
 *  added above and not here is a bullet whose second line walks back to the
 *  margin. */
const MARKERS = [...BULLETS, TASK_OPEN, TASK_DONE, PICTURE, ':', '\\d+\\.']
const FURNITURE = new RegExp(`^(?:${QUOTE})*(?: *)(?:${MARKERS.join('|')})? ?`, 'u')

/** As many spaces as a line's furniture was wide, with its quote bars kept.
 *
 *  What the rows after the first are indented by, so the second half of a wrapped
 *  list item sits under the words of the first rather than back at the margin. The
 *  bars are kept as bars, because a quote that loses its bar half way down stops
 *  being a quote; everything else becomes room. */
export function hangOf(text: string): string {
  const found = FURNITURE.exec(text)?.[0] ?? ''
  if (found === '') return ''

  const bars = QUOTE.repeat(found.match(new RegExp(QUOTE, 'gu'))?.length ?? 0)
  const spare = Math.max(0, Math.round((width(found) - width(bars)) / width(' ')))

  return bars + ' '.repeat(spare)
}

/** A run of digits as superscripts, or null when it is not all digits. */
function raise(text: string, digits: string): string | null {
  if (!/^\d+$/.test(text)) return null

  let out = ''
  for (const one of text) out += digits[Number(one)] ?? one
  return out
}

/** Where each block began in the file.
 *
 *  The same walk `blocksOf` used, and for the same reason: marked gives every
 *  token the text it was made from, so a walk in document order finds each one
 *  after the last. A container is looked up without being consumed so that the
 *  tokens inside it are found within it. A blockquote is the exception, because
 *  the lexer hands its children their lines with the `>` already taken off and
 *  there is nothing left to search for; those fall back to the start of the
 *  quote, which is where a reader sent there would want to be anyway. */
class Locator {
  private at = 0

  constructor(private readonly source: string) {}

  /** The offset of `raw`, with the cursor moved past it. */
  take(raw: string): number {
    const from = this.find(raw)
    if (from !== null) this.at = from + raw.length
    return from ?? this.at
  }

  /** The offset of `raw` without moving on, for a block that holds others. */
  peek(raw: string): number {
    return this.find(raw) ?? this.at
  }

  private find(raw: string): number | null {
    if (!raw) return null
    const found = this.source.indexOf(raw, this.at)
    return found < 0 ? null : found
  }
}

/** Which line of the file an offset is on, counting from one.
 *
 *  Built once for the note rather than counted per line: a note of a thousand
 *  lines asked a thousand times is a thousand scans of the whole file. */
class Lines {
  private readonly starts: number[] = [0]

  constructor(source: string) {
    for (let at = 0; at < source.length; at++) {
      if (source[at] === '\n') this.starts.push(at + 1)
    }
  }

  /** Where a line of the file begins, counting the line from one. Undefined past the
   *  end of the file, which is a line nothing asks about. */
  startOf(line: number): number | undefined {
    return this.starts[line - 1]
  }

  at(offset: number): number {
    let low = 0
    let high = this.starts.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if ((this.starts[middle] ?? 0) <= offset) low = middle
      else high = middle - 1
    }

    return low + 1
  }
}

function textOf(token: Token): string {
  return 'text' in token && typeof token.text === 'string' ? token.text : ''
}

function rawOf(token: Token): string {
  return 'raw' in token && typeof token.raw === 'string' ? token.raw : ''
}

function childrenOf(token: Token): Token[] {
  return 'tokens' in token && Array.isArray(token.tokens) ? token.tokens : []
}

const HTML_TAG = /<[^>]*>/g

/** A callout is a blockquote whose first line names a kind; see `callouts` in the
 *  markdown package. */
const CALLOUT = /^\s*\[!(note|tip|important|warning|caution)\]\s*/i

/** A paragraph's own line breaks, as the space markdown says they are.
 *
 *  A paragraph hard wrapped in the file is one paragraph, and a single newline in
 *  the middle of it is a space. Without this it was a line break: every hard
 *  wrapped paragraph in every note came out as two lines on the panel, both
 *  numbered with the line the paragraph started on, and the panel held half as much
 *  as it should. A hard break, which the author wrote two spaces for, is a `br`
 *  token and still breaks. */
function flowing(text: string, flow: boolean): string {
  // Only at the compaction the plugin has always had. At the other two a newline
  // the author wrote is a line the reader asked for; see `Compaction`.
  if (!flow) return text.replace(/[ \t]*\n[ \t]*/gu, '\n')
  return text.replace(/[ \t]*\n[ \t]*/gu, ' ')
}

/** The marks a styling token was written with, put back on when the reader asked
 *  to see them. Off, the words are the whole of it, which is rule one. */
const AROUND: Readonly<Record<string, [string, keyof Marks]>> = {
  strong: ['**', 'bold'],
  em: ['*', 'italic'],
  del: ['~~', 'strike'],
  highlight: ['==', 'highlight'],
}

function around(words: string, type: string, marks: Marks): string {
  const found = AROUND[type]
  if (!found || !marks[found[1]]) return words

  return `${found[0]}${words}${found[0]}`
}

/** A link, as the reader asked to see it: the words it shows, or the markdown it
 *  was written as. */
function linked(token: Token, kids: readonly Token[], marks: Marks, flow: boolean): string {
  const shown = kids.length ? inlineWords(kids, marks, flow) : textOf(token)
  if (!marks.link) return shown

  const href = 'href' in token && typeof token.href === 'string' ? token.href : ''
  return href ? `[${shown}](${href})` : shown
}

/** The words of a run of inline tokens, with every mark that only styles them
 *  taken off and every mark that says what they are kept.
 *
 *  This is rule one, and it is the whole of why it is short: `strong`, `em`,
 *  `del`, `highlight` and the rest simply recurse. Their children are the words,
 *  and the words are what a reader wants. */
function inlineWords(tokens: readonly Token[], marks: Marks, flow: boolean): string {
  let out = ''

  for (const token of tokens) {
    const kids = childrenOf(token)

    switch (token.type) {
      // Emphasis of every kind: the words, and none of the marks around them.
      case 'strong':
      case 'em':
      case 'del':
      case 'highlight':
        out += around(inlineWords(kids, marks, flow), token.type, marks)
        break

      // Code, which is the one inline mark that changes what the words mean, so
      // it keeps the ticks it was written with.
      case 'codespan':
        out += marks.code ? `\`${textOf(token)}\`` : textOf(token)
        break

      // Maths is source too, and its dollars say so.
      case 'inlineMath':
        out += `$${textOf(token)}$`
        break

      case 'superscript':
      case 'subscript': {
        const inside = kids.length ? inlineWords(kids, marks, flow) : textOf(token)
        const digits = token.type === 'superscript' ? SUPERS : SUBS
        // The font has the ten digits raised and nothing else, so anything else
        // is set on the line rather than guessed at.
        out += raise(inside, digits) ?? inside
        break
      }

      case 'link':
        // The words it shows. A link with nothing to show is its own address,
        // which is then the only thing there is to read.
        out += linked(token, kids, marks, flow)
        break

      case 'wikilink':
      case 'embed':
        // Already the name of the note it points at, or the words written in
        // place of it; see `shownText` in the markdown package.
        out += textOf(token)
        break

      case 'image':
        // A picture in the middle of a sentence is what it was described as. Its
        // address if it was described as nothing, so the line is not a gap.
        out +=
          textOf(token) || ('href' in token && typeof token.href === 'string' ? token.href : '')
        break

      case 'footnoteRef': {
        const id = 'id' in token && typeof token.id === 'string' ? token.id : ''
        out += raise(id, SUPERS) ?? `[^${id}]`
        break
      }

      case 'br':
        out += '\n'
        break

      case 'html':
        // Markup is not words. What is left when the tags come off is.
        out += textOf(token).replace(HTML_TAG, '')
        break

      case 'emoji':
      case 'escape':
      case 'text':
        out += kids.length ? inlineWords(kids, marks, flow) : flowing(textOf(token), flow)
        break

      default:
        // Anything the grammar knows and this does not yet: its words, which is
        // better than a hole in the note.
        out += kids.length ? inlineWords(kids, marks, flow) : flowing(textOf(token), flow)
    }
  }

  return out
}

/** A heading, as its level can be told from one font.
 *
 *  Capitals throughout, which is the one weight a single face has. The level on
 *  top of that: the first two are underlined, heavily and then lightly, the third
 *  is the unmarked middle, and the last three carry a chevron each. Every level
 *  is told from every other, and a heading is told from prose by its capitals
 *  alone.
 *
 *  Language neutral on purpose. Capitals do nothing to Japanese, and the rules
 *  and the chevrons still separate all six. */
const CHEVRON = '›'
const UNDERLINES: Readonly<Record<number, string>> = { 1: '═', 2: '─' }

function heading(level: number, words: string, from: number, nest: Nest, sheet: Sheet): void {
  // The hashes only where the reader asked for them: the capitals already say it
  // is a heading and the chevrons already say which level.
  const hashes = sheet.marks.heading ? `${'#'.repeat(level)} ` : ''
  const lead = level >= 4 ? `${CHEVRON.repeat(level - 3)} ` : ''
  sheet.add(`${hashes}${lead}${words.toUpperCase()}`, from, nest, { level })

  // The first two levels are underlined, and that underline is furniture rather
  // than a line of the note: when the heading opens a page it becomes the head
  // band's own rule instead of being drawn twice. See `pages.ts`.
  const rule = UNDERLINES[level]
  if (rule) sheet.add(ruleOf(rule, sheet.width), from, nest, { glued: true, under: true })
}

/** How a column's cells sit in it. The table's own alignment, as written. */
type Align = 'left' | 'center' | 'right'

const ALIGNS = new Set<Align>(['left', 'center', 'right'])

/** A cell padded to a column's width, on whichever side its alignment asks. */
function pad(text: string, room: number, align: Align): string {
  const spare = Math.max(0, Math.floor((room - width(text)) / SPACE))
  if (align === 'right') return ' '.repeat(spare) + text
  if (align === 'center') {
    const before = Math.floor(spare / 2)
    return ' '.repeat(before) + text + ' '.repeat(spare - before)
  }

  return text + ' '.repeat(spare)
}

/** The space between two columns. Two spaces, ten pixels. */
const GUTTER = '  '

/** A table as columns that line up.
 *
 *  The font is proportional, so a column cannot be counted in characters: `MMM`
 *  and `iii` are thirty pixels apart. So each column is measured in pixels and
 *  the gap is spent on spaces, which are five pixels each, and a column lines up
 *  within five pixels of where it should - under one percent of the panel.
 *
 *  A table too wide for the panel is fitted rather than wrapped: every column
 *  gives up the same share of itself, so the widest is still the widest, and
 *  each cell is cut with an ellipsis. Wrapping would put half of row four under
 *  column two and lose the one thing a table has. */
function tableLines(
  head: readonly string[],
  rows: readonly (readonly string[])[],
  align: readonly Align[],
  inner: number,
): string[] {
  const columns = Math.max(head.length, ...rows.map((row) => row.length), 1)
  const gap = width(GUTTER)
  const at = (row: readonly string[], column: number) => row[column] ?? ''
  const spread = (row: readonly string[]) =>
    Array.from({ length: columns }, (_one, column) => at(row, column))

  const natural = Array.from({ length: columns }, (_one, column) =>
    Math.max(width(at(head, column)), ...rows.map((row) => width(at(row, column))), 0),
  )

  const room = Math.max(width('…') * columns, inner - gap * (columns - 1))
  const wanted = natural.reduce((sum, one) => sum + one, 0)
  const share = wanted > room ? room / wanted : 1
  const widths = natural.map((one) => Math.max(width('…'), Math.floor(one * share)))

  const line = (row: readonly string[]) =>
    spread(row)
      .map((cell, column) => {
        const room_ = widths[column] ?? 0
        return pad(fit(cell, room_), room_, align[column] ?? 'left')
      })
      .join(GUTTER)
      .trimEnd()

  const across = widths.reduce((sum, one) => sum + one, 0) + gap * (columns - 1)

  // A rule under the head, as wide as the table: the one piece of furniture a
  // table needs and the only one a single font can draw.
  return [line(head), ruleOf('─', Math.min(inner, across)), ...rows.map((row) => line(row))]
}

/** How deep a line sits, how many quote bars stand to its left, and whether the
 *  depth is a list's own nesting rather than a block sitting inside an item. Only
 *  the first of those is worth a step; see `stepsAt`. */
interface Nest {
  depth: number
  quote: number
  listed?: boolean
}

/** Everything the walk is putting a note into. */
class Sheet {
  readonly lines: Line[] = []
  readonly marks: Marks
  /** Whether a single newline is a space, which is the top compaction only. */
  readonly flow: boolean
  readonly compaction: Compaction
  private readonly rootIndent: boolean

  constructor(
    private readonly where: Lines,
    private readonly inner: number,
    options: MarkOptions,
  ) {
    this.marks = options.marks ?? MARKS
    this.compaction = options.compaction ?? DEFAULT_COMPACTION
    this.flow = this.compaction === 'aggressive'
    this.rootIndent = options.rootIndent ?? false
  }

  /** How far in a line at this depth sits.
   *
   *  Emil: "indentation is not forbidden, but not at the root level, that wastes
   *  space." The root level of a note is depth zero and has never carried a step,
   *  so what is left is the one case that does: the blocks *inside* a list item - a
   *  second paragraph, a fence, a quote - which used to begin three spaces further
   *  in than the item's own words. Those come back to the item's own indent, and a
   *  list nested inside a list still steps, because that step is what says which
   *  list an item belongs to and the bullets alone cannot carry three levels.
   *
   *  `rootIndent` puts the old behaviour back for anybody who wants it. */
  private stepsAt(depth: number, listed: boolean): number {
    if (this.rootIndent || listed) return depth
    return Math.max(0, depth - 1)
  }

  /** One line, with its indentation and its quote bars put on the front. */
  add(
    text: string,
    from: number,
    nest: Nest,
    options: { glued?: boolean; level?: number; under?: boolean } = {},
  ): void {
    const lead =
      QUOTE.repeat(nest.quote) + STEP.repeat(this.stepsAt(nest.depth, nest.listed === true))
    // A line that only breaks because the author wrote a hard break inside it, or
    // because the reader asked for the note's own breaks. The halves are one
    // block, so the second hangs under the first's words the same way a wrapped
    // row does - and each carries its own line of the file, because a number that
    // says 12 has to be line 12 whatever was folded into it.
    let hang = ''
    const first = this.where.at(from)
    for (const [at, part] of text.split('\n').entries()) {
      // Folded here, at the one place a line is made, so that every line of a
      // note is a line the firmware can actually draw. See `firmware.ts`.
      const whole = fold(`${lead}${at === 0 ? part : hang + part.trimStart()}`)
      if (at === 0) hang = hangOf(whole)

      // Each part is a line of the file in its own right, so it carries that line's
      // own offset rather than the block's. Asked of the line index rather than
      // counted through the text, because the text has had its marks taken off and is
      // no longer the length of what it came from. Without this every row of a
      // soft-wrapped paragraph claimed to begin where the paragraph did, and nothing
      // downstream could tell one row from another - which is what left the frame on
      // the phone still while the glasses scrolled.
      const began = at === 0 ? from : (this.where.startOf(first + at) ?? from)

      this.lines.push({
        text: whole,
        from: began,
        at: first + at,
        // A part after the first is glued to the one before it only where the split
        // can only have come from a hard break the author wrote - which is the top
        // compaction, where a soft wrap is a space. At the other two a part is a line
        // of the note in its own right and may start a page of its own; glued, a
        // thirty line paragraph was one unbreakable run and a scroll moved by all of
        // it at once.
        glued: (at > 0 && this.flow) || options.glued === true,
        level: at === 0 ? (options.level ?? 0) : 0,
        under: at === 0 && options.under === true,
      })
    }
  }

  /** A blank row, for the compaction that draws the note's own empty lines. */
  blank(from: number, line: number): void {
    this.lines.push({ text: '', from, at: line, glued: false, level: 0, under: false })
  }

  /** Which line of the file an offset is on. */
  lineAt(from: number): number {
    return this.where.at(from)
  }

  /** A run of lines that belong together: the first may start a page, the rest
   *  follow it wherever it went. */
  addAll(texts: readonly string[], from: number, nest: Nest): void {
    for (const [at, text] of texts.entries()) {
      this.add(text, from, nest, at === 0 ? {} : { glued: true })
    }
  }

  get width(): number {
    return this.inner
  }
}

/** Every block of a note, in the order it is read. */
function walk(tokens: readonly Token[], where: Locator, nest: Nest, sheet: Sheet): void {
  for (const token of tokens) block(token, where, nest, sheet)
}

function block(token: Token, where: Locator, nest: Nest, sheet: Sheet): void {
  const raw = rawOf(token)
  const kids = childrenOf(token)

  switch (token.type) {
    // A blank line, a link definition, an abbreviation: none of them is content,
    // and none of them shows on a page either.
    case 'space': {
      // The blank lines between two blocks. Nothing at all at the two compactions
      // that fold them, and one row each at the one that does not: "every line
      // break as written, even ten in a row". Each row carries its own line of the
      // file, so the numbers down the side still count what is there.
      const from = where.take(raw)
      if (sheet.compaction !== 'none') break

      // The run begins with the newline that ended the block above, so the first
      // blank line of the note is the line after the one that offset is on.
      const blanks = (raw.match(/\n/gu)?.length ?? 0) - 1
      const first = sheet.lineAt(from) + 1
      for (let at = 0; at < blanks; at++) sheet.blank(from, first + at)
      break
    }

    case 'def':
    case 'abbrDef':
      where.take(raw)
      break

    case 'heading': {
      const level = 'depth' in token && typeof token.depth === 'number' ? token.depth : 1
      heading(level, inlineWords(kids, sheet.marks, sheet.flow), where.take(raw), nest, sheet)
      break
    }

    case 'hr':
      sheet.add(ruleOf('─', sheet.width), where.take(raw), nest)
      break

    case 'code':
      fence(token, where, nest, sheet)
      break

    case 'blockMath': {
      // Its own source, between the dollars it was written with. A formula that
      // cannot be drawn is still a formula that can be read.
      const from = where.take(raw)
      sheet.addAll(['$$', ...textOf(token).split('\n'), '$$'], from, nest)
      break
    }

    case 'paragraph': {
      const from = where.take(raw)
      const picture = onlyPicture(kids)
      if (picture) sheet.add(`${PICTURE} ${picture}`, from, nest)
      else sheet.add(inlineWords(kids, sheet.marks, sheet.flow), from, nest)
      break
    }

    case 'text':
      sheet.add(
        kids.length ? inlineWords(kids, sheet.marks, sheet.flow) : textOf(token),
        where.take(raw),
        nest,
      )
      break

    case 'html':
      sheet.add(textOf(token).replace(HTML_TAG, '').trim(), where.take(raw), nest)
      break

    case 'blockquote':
      quote(token, where, nest, sheet)
      break

    case 'list':
      list(token, where, nest, sheet)
      break

    case 'table':
      table(token, where, nest, sheet)
      break

    case 'definitionList':
      definitions(token, where, nest, sheet)
      break

    case 'footnoteDef':
      footnote(token, where, nest, sheet)
      break

    default:
      sheet.add(textOf(token), where.take(raw), nest)
  }
}

/** A fence, with the lines it was written between and its code as it stands.
 *
 *  The opening and closing lines are kept because they are the one thing a reader
 *  cannot work out for themselves: on a panel with one font, code and prose look
 *  exactly alike, and knowing which is which changes what the words mean. */
function fence(token: Token, where: Locator, nest: Nest, sheet: Sheet): void {
  const language = ('lang' in token && typeof token.lang === 'string' ? token.lang : '').trim()
  const raw = rawOf(token)
  const code = textOf(token)
  const from = where.take(raw)
  // Each line of code keeps its own place in the file, so a page break inside a
  // long fence still maps back to the line the reader is looking at, and "go to
  // line" reaches a line of code.
  let inside = from + Math.max(0, raw.indexOf(code))

  // The ``` lines are the one thing a reader cannot work out for themselves, so
  // they are on unless the reader turned them off. Off, the code is still every
  // line of it, glued together and unwrapped: rule two.
  const marked = sheet.marks.fence
  if (marked) sheet.add(`${FENCE}${language}`, from, nest)
  for (const [at, line] of code.split('\n').entries()) {
    sheet.add(line, inside, nest, { glued: marked || at > 0 })
    inside += line.length + 1
  }
  if (marked) {
    sheet.add(FENCE, from + Math.max(0, raw.length - FENCE.length - 1), nest, { glued: true })
  }
}

/** A paragraph that holds one picture and nothing else. */
function onlyPicture(tokens: readonly Token[]): string | null {
  const shown = tokens.filter((one) => one.type !== 'text' || textOf(one).trim() !== '')
  const first = shown[0]
  if (shown.length !== 1 || first?.type !== 'image') return null

  const source = 'href' in first && typeof first.href === 'string' ? first.href : ''
  return textOf(first) || source || null
}

function quote(token: Token, where: Locator, nest: Nest, sheet: Sheet): void {
  const kids = childrenOf(token)
  const from = where.peek(rawOf(token))
  const inside: Nest = { depth: nest.depth, quote: nest.quote + 1 }

  const first = kids[0]
  const kind = first ? CALLOUT.exec(textOf(first))?.[1] : undefined
  if (kind) {
    // A callout's kind is a heading of its own on a page, and here it is the
    // label in capitals, which is the only emphasis one font has.
    sheet.add(kind.toUpperCase(), from, inside)
  }

  const body = kind ? kids.map((one, at) => (at === 0 ? withoutCallout(one) : one)) : kids
  walk(body, where, inside, sheet)
}

/** The first token of a callout with its `[!note]` marker taken off. */
function withoutCallout(token: Token): Token {
  const kids = childrenOf(token)
  const first = kids[0]
  if (first?.type === 'text') {
    return {
      ...token,
      tokens: [{ ...first, text: textOf(first).replace(CALLOUT, '') }, ...kids.slice(1)],
    }
  }

  return { ...token, text: textOf(token).replace(CALLOUT, '') }
}

function list(token: Token, where: Locator, nest: Nest, sheet: Sheet): void {
  const ordered = 'ordered' in token && token.ordered === true
  const start = 'start' in token && typeof token.start === 'number' ? token.start : 1
  const items = 'items' in token && Array.isArray(token.items) ? (token.items as Token[]) : []
  where.peek(rawOf(token))

  items.forEach((item, at) => {
    const from = where.peek(rawOf(item))
    const task = 'task' in item && item.task === true
    const done = 'checked' in item && item.checked === true
    const inside: Nest = { depth: nest.depth + 1, quote: nest.quote }
    const all = childrenOf(item)

    // A task's `[ ]` is a token of its own, and the marker below already says
    // whether it is done, so it is consumed and dropped.
    const box = all[0]
    if (box?.type === 'checkbox') where.take(rawOf(box))
    const kids = box?.type === 'checkbox' ? all.slice(1) : all

    const marker = task
      ? done
        ? TASK_DONE
        : TASK_OPEN
      : ordered
        ? `${String(start + at)}.`
        : (BULLETS[Math.min(nest.depth, BULLETS.length - 1)] ?? '-')

    // The item's own words share the line with its marker; anything else inside
    // it - a second paragraph, a fence, a list under it - follows as its own
    // block at the same indentation.
    const lead = kids[0]
    const leads = lead !== undefined && isLeading(lead)
    const words = leads
      ? inlineWords(childrenOf(lead).length ? childrenOf(lead) : [lead], sheet.marks, sheet.flow)
      : ''
    sheet.add(`${marker} ${words}`.trimEnd(), from, {
      depth: nest.depth,
      quote: nest.quote,
      listed: true,
    })
    if (leads) where.take(rawOf(lead))

    walk(leads ? kids.slice(1) : kids, where, inside, sheet)
  })
}

/** Whether an item's first token is the words that go beside its marker. */
function isLeading(token: Token): boolean {
  return token.type === 'text' || token.type === 'paragraph'
}

function table(token: Token, where: Locator, nest: Nest, sheet: Sheet): void {
  const one = token as Tokens.Table
  const cells = (row: readonly Tokens.TableCell[]) =>
    row.map((cell) => inlineWords(cell.tokens, sheet.marks, sheet.flow))

  sheet.addAll(
    tableLines(
      cells(one.header),
      one.rows.map((row) => cells(row)),
      one.align.map((given) => (given !== null && ALIGNS.has(given) ? given : 'left')),
      sheet.width - width(QUOTE.repeat(nest.quote) + STEP.repeat(nest.depth)),
    ),
    where.take(rawOf(token)),
    nest,
  )
}

interface Definition {
  term: Token[]
  details: Token[][]
}

function definitions(token: Token, where: Locator, nest: Nest, sheet: Sheet): void {
  const items = 'items' in token && Array.isArray(token.items) ? (token.items as Definition[]) : []
  const from = where.take(rawOf(token))

  for (const item of items) {
    sheet.add(inlineWords(item.term, sheet.marks, sheet.flow), from, nest)
    for (const detail of item.details) {
      // The `:` the definition was written with, which is what says the line
      // below is the one above explained.
      sheet.add(`: ${inlineWords(detail, sheet.marks, sheet.flow)}`, from, {
        depth: nest.depth + 1,
        quote: nest.quote,
      })
    }
  }
}

function footnote(token: Token, where: Locator, nest: Nest, sheet: Sheet): void {
  const id = 'id' in token && typeof token.id === 'string' ? token.id : ''
  const from = where.peek(rawOf(token))
  const mark = raise(id, SUPERS) ?? `[^${id}]`

  sheet.add(mark, from, nest)
  walk(childrenOf(token), where, { depth: nest.depth + 1, quote: nest.quote }, sheet)
}

/** A note as the lines the firmware will set, in the order they are read.
 *
 *  Positions count from the start of the file, front matter included, even
 *  though front matter is not set: it is the note's own metadata and a page does
 *  not show it either. */
export function markLines(source: string, options: MarkOptions): Line[] {
  const body = stripFrontMatter(source)
  // The locator searches the whole file, so an offset it finds is the file's.
  const sheet = new Sheet(new Lines(source), options.inner, options)
  walk(lexMarkdown(body), new Locator(source), { depth: 0, quote: 0 }, sheet)

  return sheet.lines
}
