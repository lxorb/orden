/** Blocks into lines, lines into pages.
 *
 *  The whole of the panel's typesetting, and none of its drawing. A line comes
 *  out with its runs already placed at an x, its own height and baseline, and
 *  the rectangles - a quote's bar, a fence's ground, a table's grid - that are
 *  drawn under them. A page comes out as lines at their y, the stretch of the
 *  note it shows, and a hash of every pixel-deciding thing in it.
 *
 *  Two rules about where a page may end. It ends between lines, never inside
 *  one; and a line that only exists because the one before it ran out of room -
 *  the second half of a wrapped line of code, the words after a heading - is
 *  glued to it, and the two move to the next page together. That is what keeps a
 *  page break out of the middle of a line of a fence. */

import type { CodePalette, LigatureScope } from '@nib/editor'
import {
  type Align,
  type Block,
  blocksOf,
  type BlockOptions,
  FENCE_STYLE,
  QUOTE_STEP,
} from './blocks'
import type { CodeSpan } from './code'
import { codeGreys } from './grey'
import { hashOfLines } from './hash'
import { leadingOf, type MathBox, type Measurer } from './measure'
import { TEXT_HEIGHT, TEXT_WIDTH } from './panel'
import { type Run, textRuns } from './runs'
import { FURNITURE, type TextStyle } from './style'

/** A run at its place on a line, measured. */
export interface Placed {
  run: Run
  /** From the left edge of the text column, in pixels. */
  x: number
  width: number
}

/** A filled rectangle drawn under the runs: a rule, a quote's bar, a fence's
 *  ground, a grid line. In line coordinates: x from the text column's left
 *  edge, y from the line's own top. */
interface Fill {
  x: number
  y: number
  width: number
  height: number
  grey: number
}

export interface Line {
  placed: Placed[]
  height: number
  /** From the line's top down to the baseline. */
  baseline: number
  /** Where in the note the block this line came from began. */
  from: number
  fills: Fill[]
  /** True when this line may not start a page: it belongs with the one above. */
  glue: boolean
}

export interface Page {
  index: number
  /** Offset in the note of the first block shown on this page. */
  from: number
  /** Offset just past the last character this page accounts for. */
  to: number
  lines: Line[]
  /** Each line's top, from the top of the text area. */
  tops: number[]
  hash: string
}

export interface LayoutOptions extends BlockOptions {
  measure: Measurer
  /** The code theme, whose colours become greys; see grey.ts. */
  palette: CodePalette
  /** For a panel that is not the G2's. Both default to the G2's text area. */
  width?: number
  height?: number
}

/** The smallest thing wrapping produces: a word, the space between two words, a
 *  hard break, or something drawn rather than written, which cannot be cut. */
interface Atom {
  run: Run
  width: number
  /** A space, which is dropped when it falls at the end of a line. */
  blank: boolean
}

/** Scripts that break between characters rather than at spaces: the CJK
 *  punctuation and kana blocks, the ideographs, the compatibility ideographs and
 *  the fullwidth forms. Written by code point because one of them is an
 *  ideographic space, which no reader of this file could see. */
const CJK = /[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/

/** Where a line may break: any whitespace, the newlines a paragraph was typed
 *  with included. */
const SPACE = /\s/

function atomsOf(run: Run, measure: Measurer): Atom[] {
  // Drawn, or a break: one piece, uncuttable.
  if (run.break === true || run.math || run.picture) {
    return [{ run, width: drawnBox(run, measure)?.width ?? 0, blank: false }]
  }

  // A ligature glyph stands for its characters as one piece, and takes their
  // width; cutting it would leave half an arrow.
  if (run.over !== undefined) {
    return [{ run, width: measure.width(run.over, run.style), blank: false }]
  }

  const out: Atom[] = []
  const push = (text: string, blank: boolean) => {
    out.push({ run: { ...run, text }, width: measure.width(text, run.style), blank })
  }

  let word = ''
  for (const character of run.text) {
    const space = SPACE.test(character)
    if (!space && !CJK.test(character)) {
      word += character
      continue
    }

    if (word) push(word, false)
    word = ''
    // A line break inside a paragraph is a space, the way it is on a page: the
    // lexer hands over the newlines the author typed, and drawing one leaves a
    // hole in the middle of a sentence. A tab keeps its own width, which is
    // what indented code is made of.
    push(character === '\n' || character === '\r' ? ' ' : character, space)
  }
  if (word) push(word, false)

  return out
}

interface Row {
  placed: Placed[]
  height: number
  baseline: number
}

/** The box a run that is drawn rather than written takes, with how far of it is
 *  below the baseline, or null when the run is words. Measuring a formula means
 *  laying it out, so the measurer keeps its answers; see measure.ts. */
function drawnBox(run: Run, measure: Measurer): MathBox | null {
  if (run.math) return measure.math(run.math.tex, run.math.display)
  if (run.picture) {
    const box = measure.picture(run.picture.source, { width: TEXT_WIDTH, height: TEXT_HEIGHT })
    // A picture sits on the line, like a very large letter.
    return box ? { ...box, depth: 0 } : null
  }

  return null
}

/** How far a run stands above and below the baseline. */
function reach(run: Run, measure: Measurer): { up: number; down: number } {
  const drawn = drawnBox(run, measure)
  if (drawn) return { up: drawn.height - drawn.depth, down: drawn.depth }

  const rise = run.rise ?? 0
  return {
    up: measure.ascent(run.style) + rise,
    down: Math.max(0, measure.descent(run.style) - rise),
  }
}

/** Runs broken to fit `width`, each row's pieces placed from `x = 0`. */
function wrap(
  runs: readonly Run[],
  width: number,
  measure: Measurer,
  align: Align = 'left',
): Row[] {
  const rows: Row[] = []
  let taken: Atom[] = []
  let used = 0

  const flush = () => {
    // A trailing space belongs to the break, not to the line.
    while (taken.length && taken[taken.length - 1]?.blank === true) taken.pop()
    if (!taken.length) return

    let up = 0
    let down = 0
    let size = 0
    for (const atom of taken) {
      const { up: over, down: under } = reach(atom.run, measure)
      up = Math.max(up, over)
      down = Math.max(down, under)
      size = Math.max(size, atom.run.style.size)
    }

    const room = taken.reduce((sum, atom) => sum + atom.width, 0)
    const start = align === 'center' ? (width - room) / 2 : align === 'right' ? width - room : 0

    let x = Math.max(0, start)
    const placed: Placed[] = []
    for (const atom of taken) {
      placed.push({ run: atom.run, x, width: atom.width })
      x += atom.width
    }

    rows.push({ placed, baseline: Math.round(up), height: Math.round(up + down + leadingOf(size)) })
    taken = []
    used = 0
  }

  for (const atom of runs.flatMap((run) => atomsOf(run, measure))) {
    if (atom.run.break === true) {
      flush()
      continue
    }

    if (used + atom.width > width && taken.length) flush()

    // A space at the start of a line is the one the break already ate - whether
    // the break happened before this atom or is this atom, which is why the
    // check comes after the width test rather than before it. Only after a
    // break, though: the spaces a line of code opens with are its indentation,
    // and losing those would flatten every fence in the note.
    if (!taken.length && atom.blank && rows.length > 0) continue

    // One piece wider than the whole column - a long address, a run of code
    // with no spaces in it - is cut by characters, the only cut left.
    if (atom.width > width && atom.run.text.length > 1) {
      for (const piece of splitToFit(atom.run, width, measure)) {
        if (used + piece.width > width && taken.length) flush()
        taken.push(piece)
        used += piece.width
      }
      continue
    }

    taken.push(atom)
    used += atom.width
  }
  flush()

  return rows.length ? rows : [{ placed: [], height: 0, baseline: 0 }]
}

function splitToFit(run: Run, width: number, measure: Measurer): Atom[] {
  const out: Atom[] = []
  let piece = ''
  let taken = 0

  for (const character of run.text) {
    const step = measure.width(character, run.style)
    if (piece && taken + step > width) {
      out.push({ run: { ...run, text: piece }, width: taken, blank: false })
      piece = ''
      taken = 0
    }
    piece += character
    taken += step
  }
  if (piece) out.push({ run: { ...run, text: piece }, width: taken, blank: false })

  return out
}

function quoteBars(quote: number, height: number): Fill[] {
  const fills: Fill[] = []
  for (let at = 0; at < quote; at++) {
    fills.push({ x: at * QUOTE_STEP, y: 0, width: 2, height, grey: FURNITURE.quoteBar })
  }

  return fills
}

type Greys = ReturnType<typeof codeGreys>

/** Every line of the note in order, before pages are cut out of them. */
function linesOf(blocks: readonly Block[], options: LayoutOptions): Line[] {
  const measure = options.measure
  const column = options.width ?? TEXT_WIDTH
  const tall = options.height ?? TEXT_HEIGHT
  const greys = codeGreys(options.palette)
  const out: Line[] = []
  /** True while the block just laid out was a heading, so the words under it are
   *  glued to it and no heading is ever the last line on a page. */
  let afterHeading = false

  const emit = (rows: readonly Row[], block: Block, left: number, glued: boolean) => {
    rows.forEach((row, at) => {
      out.push({
        placed: row.placed.map((one) => ({ ...one, x: one.x + left })),
        height: row.height,
        baseline: row.baseline,
        from: block.from,
        fills: quoteBars(block.quote, row.height),
        glue: at > 0 || glued,
      })
    })
  }

  for (const block of blocks) {
    const left = block.indent + block.quote * QUOTE_STEP
    const room = Math.max(24, column - left)
    const wasHeading = afterHeading
    afterHeading = block.kind === 'heading'

    switch (block.kind) {
      case 'heading':
      case 'text':
        emit(wrap(block.runs, room, measure), block, left, wasHeading)
        break

      case 'item': {
        const at = out.length
        emit(wrap(block.runs, room, measure), block, left, wasHeading)
        hangMarker(out[at], block.marker, left, measure)
        break
      }

      case 'rule': {
        const height = 9
        out.push({
          placed: [],
          height,
          baseline: height,
          from: block.from,
          fills: [
            ...quoteBars(block.quote, height),
            { x: left, y: 4, width: room, height: 1, grey: FURNITURE.rule },
          ],
          glue: wasHeading,
        })
        break
      }

      case 'code':
        codeLines(block, options, greys, left, room, out, wasHeading)
        break

      case 'math': {
        const box = measure.math(block.tex, true)
        const run: Run = {
          text: block.tex,
          style: FENCE_STYLE,
          math: { tex: block.tex, display: true },
        }
        emit([centred(run, box, room, 6)], block, left, wasHeading)
        break
      }

      case 'picture': {
        const box = measure.picture(block.source, { width: room, height: tall })
        if (!box) {
          const alt = [{ text: block.alt || block.source, style: FENCE_STYLE }]
          emit(wrap(alt, room, measure), block, left, wasHeading)
          break
        }

        const run: Run = { text: block.alt, style: FENCE_STYLE, picture: { source: block.source } }
        emit([centred(run, box, room, 4)], block, left, wasHeading)
        break
      }

      case 'table':
        tableLines(block, measure, left, room, out, wasHeading)
        break
    }
  }

  return out
}

/** One drawn thing on a line of its own, in the middle of the column.
 *
 *  Never wider than the column: a formula that would run off the edge is drawn
 *  smaller instead, which is what a page does with one too. The rasteriser draws
 *  it into the width placed here, so the two agree without either being told. */
function centred(run: Run, box: { width: number; height: number }, room: number, air: number): Row {
  const scale = Math.min(1, room / box.width)
  const width = Math.floor(box.width * scale)
  const height = Math.round(box.height * scale)

  return {
    placed: [{ run, x: Math.max(0, Math.round((room - width) / 2)), width }],
    height: height + air,
    baseline: height,
  }
}

/** The bullet or the number, hanging in the indent the item already has. */
function hangMarker(
  line: Line | undefined,
  marker: readonly Run[],
  left: number,
  measure: Measurer,
): void {
  if (!line) return

  const total = marker.reduce((sum, run) => sum + measure.width(run.text, run.style), 0)
  let x = left - total - 4
  for (const run of marker) {
    const width = measure.width(run.text, run.style)
    line.placed.unshift({ run, x, width })
    x += width
  }
}

/** A fence: one line per source line, its ground drawn behind, and a wrapped
 *  line's remainder glued to it so a page break cannot fall inside it. */
function codeLines(
  block: Extract<Block, { kind: 'code' }>,
  options: LayoutOptions,
  greys: Greys,
  left: number,
  room: number,
  out: Line[],
  afterHeading: boolean,
): void {
  const measure = options.measure
  const pad = 5
  const inner = Math.max(24, room - 2 * pad)

  block.lines.forEach((spans, at) => {
    const runs = spansToRuns(spans, greys, options.scope)
    const rows = wrap(runs.length ? runs : [{ text: '', style: FENCE_STYLE }], inner, measure)
    const first = at === 0
    const last = at === block.lines.length - 1

    rows.forEach((row, row_at) => {
      // An empty source line still takes a line of the fence.
      const height = row.height || Math.round(FENCE_STYLE.size * 1.3)
      const rules: Fill[] = []
      if (first && row_at === 0) {
        rules.push({ x: left, y: 0, width: room, height: 1, grey: FURNITURE.rule })
      }
      if (last && row_at === rows.length - 1) {
        rules.push({ x: left, y: height - 1, width: room, height: 1, grey: FURNITURE.rule })
      }

      out.push({
        placed: row.placed.map((one) => ({ ...one, x: one.x + left + pad })),
        height,
        baseline: row.baseline || Math.round(FENCE_STYLE.size),
        from: block.from,
        fills: [
          ...quoteBars(block.quote, height),
          { x: left, y: 0, width: room, height, grey: FURNITURE.codeBlock },
          ...rules,
        ],
        // The first row of a source line may open a page; its remainder may not,
        // and neither may the first line of a fence right under a heading.
        glue: row_at > 0 || (first && row_at === 0 && afterHeading),
      })
    })
  })
}

function spansToRuns(spans: readonly CodeSpan[], greys: Greys, scope: LigatureScope): Run[] {
  return spans.flatMap((span) => {
    const look = greys[span.role]
    const style: TextStyle = {
      ...FENCE_STYLE,
      grey: look.level,
      weight: look.weight,
      slant: look.slant,
    }
    // A fence is code, so the `code` scope reaches it as well as `all`.
    return textRuns(span.text, style, { scope, code: true })
  })
}

/** A table: one line per row, cells cut to their column, and a grid.
 *
 *  A cell is set on one line and cut where it does not fit rather than wrapping.
 *  A panel 288 pixels tall holds about ten lines of prose, and a table whose
 *  cells wrap spends a whole page on three rows. */
function tableLines(
  block: Extract<Block, { kind: 'table' }>,
  measure: Measurer,
  left: number,
  room: number,
  out: Line[],
  afterHeading: boolean,
): void {
  const gap = 8
  const columns = block.head.length
  if (!columns) return

  const rows = [block.head, ...block.rows]
  const widthOf = (cell: readonly Run[] | undefined) =>
    (cell ?? []).reduce((sum, run) => sum + measure.width(run.text, run.style), 0)

  const natural = block.head.map((_cell, at) => Math.max(...rows.map((row) => widthOf(row[at]))))
  const wanted = natural.reduce((sum, one) => sum + one, 0)
  const available = Math.max(columns * 12, room - gap * columns)
  const scale = wanted > available ? available / wanted : 1
  const widths = natural.map((one) => Math.max(12, Math.floor(one * scale)))

  const offsets: number[] = []
  let x = 0
  for (const width of widths) {
    offsets.push(x)
    x += width + gap
  }

  rows.forEach((row, at) => {
    const head = at === 0
    let up = 0
    let down = 0
    const placed: Placed[] = []

    widths.forEach((width, column) => {
      const start = (offsets[column] ?? 0) + left
      const cell = row[column] ?? []
      const align = block.align[column] ?? 'left'
      const cut = cellLine(cell, width, measure, align)
      if (!cut) return

      up = Math.max(up, cut.line.baseline)
      down = Math.max(down, cut.line.height - cut.line.baseline)
      for (const one of cut.line.placed) placed.push({ ...one, x: one.x + start })
      if (cut.mark) placed.push({ ...cut.mark, x: cut.mark.x + start })
    })

    const height = Math.max(Math.round(up + down), 12)
    out.push({
      placed,
      height,
      baseline: Math.round(up),
      from: block.from,
      fills: [
        ...quoteBars(block.quote, height),
        // A rule under every row, and a heavier one under the head.
        { x: left, y: height - 1, width: room, height: head ? 2 : 1, grey: FURNITURE.tableGrid },
        ...offsets.slice(1).map((offset) => ({
          x: left + offset - Math.round(gap / 2),
          y: 0,
          width: 1,
          height,
          grey: FURNITURE.tableGrid,
        })),
      ],
      // Neither the head alone at the foot of a page, nor a table right under a
      // heading that then sits alone.
      glue: at === 1 || (head && afterHeading),
    })
  })
}

/** One cell on one line, with an ellipsis where it went on.
 *
 *  A cell is set on a single line: a panel 288 pixels tall holds about ten of
 *  them, and a table whose cells wrap spends a whole page on three rows. So a
 *  cell that does not fit is cut, and says it was cut, rather than stopping mid
 *  word and leaving the reader to guess whether that was all of it. The mark's
 *  own room is taken off the column before the words are set, so nothing has to
 *  be unplaced afterwards. */
function cellLine(
  cell: readonly Run[],
  width: number,
  measure: Measurer,
  align: Align,
): { line: Row; mark: Placed | null } | null {
  const whole = wrap(cell, width, measure, align)
  const first = whole[0]
  if (!first) return null
  if (whole.length === 1) return { line: first, mark: null }

  const style = first.placed.at(-1)?.run.style
  if (!style) return { line: first, mark: null }

  const markWidth = measure.width('…', style)
  const short = wrap(cell, Math.max(4, width - markWidth), measure, align)[0]
  if (!short) return { line: first, mark: null }

  const used = short.placed.reduce((sum, one) => Math.max(sum, one.x + one.width), 0)
  return { line: short, mark: { run: { text: '…', style }, x: used, width: markWidth } }
}

/** Where the glued run that the incoming line belongs to begins, so the whole
 *  run can move to the next page. `taken.length` when nothing has to move. */
function groupStart(taken: readonly Line[], incoming: Line): number {
  if (!incoming.glue) return taken.length

  let at = taken.length
  while (at > 0 && taken[at - 1]?.glue === true) at--

  // And past the line the run is glued to.
  return Math.max(0, at - 1)
}

/** Lines cut into pages. Fills a page until the next line does not fit, then
 *  hands the glued run at the end of it to the next page - unless the run is a
 *  whole page tall, in which case it is broken, because something has to give. */
function paginate(lines: readonly Line[], height: number): Page[] {
  const pages: Page[] = []
  let taken: Line[] = []
  let tops: number[] = []
  let used = 0

  const put = (line: Line) => {
    tops.push(used)
    taken.push(line)
    used += line.height
  }

  const close = () => {
    if (!taken.length) return

    const from = taken[0]?.from ?? 0
    pages.push({
      index: pages.length,
      from,
      to: from,
      lines: taken,
      tops,
      hash: hashOfLines(taken, tops),
    })
    taken = []
    tops = []
    used = 0
  }

  for (const line of lines) {
    if (used + line.height > height && taken.length) {
      let keep = groupStart(taken, line)
      // The whole page is one glued run and the next line still will not fit:
      // let the run break rather than turn out an empty page.
      if (keep === 0) keep = taken.length

      const moved = taken.slice(keep)
      taken = taken.slice(0, keep)
      tops = tops.slice(0, keep)
      close()
      for (const one of moved) put(one)
    }

    put(line)
  }
  close()

  return pages
}

/** Each page's stretch of the note: from its own first block to the next page's
 *  first block, and for the last one to the end of the note. */
function withEnds(pages: readonly Page[], length: number): Page[] {
  return pages.map((page, at) => ({ ...page, to: pages[at + 1]?.from ?? length }))
}

/** Blocks as pages. Apart from `layoutNote` because the drawn things in a note -
 *  its formulae, its pictures - have to be prepared between the two steps, and
 *  preparing them means waiting; see `prepare` in raster.ts. */
export function pagesOf(blocks: readonly Block[], length: number, options: LayoutOptions): Page[] {
  return withEnds(paginate(linesOf(blocks, options), options.height ?? TEXT_HEIGHT), length)
}

/** A note as pages, in one step. What a test uses, and what an app uses for a
 *  note with nothing in it that has to be drawn first. */
export function layoutNote(source: string, options: LayoutOptions): Page[] {
  return pagesOf(blocksOf(source, options), source.length, options)
}

/** Which page holds a position in the note. What keeps the reader where they
 *  were when the note is edited under them. */
export function pageAt(pages: readonly Page[], position: number): number {
  for (const page of pages) {
    if (position < page.to) return page.index
  }

  return Math.max(0, pages.length - 1)
}
