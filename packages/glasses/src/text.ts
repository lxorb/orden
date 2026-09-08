/** A note as pages the glasses set themselves.
 *
 *  The other pager here lays a note out in our own faces and hands the panel
 *  four bitmaps; this one hands the panel a string and lets the firmware set it.
 *  That is nine times faster over the radio - one `textContainerUpgrade` of
 *  about 83 ms against four image sends of about 185 ms each - and it is drawn
 *  natively, so a page turn arrives at once rather than a quarter at a time.
 *  What it costs is every face, every weight, the code colours and the tables.
 *
 *  It needs a pager of its own, and that is measured rather than assumed. The
 *  firmware sets one font at a fixed 27 pixel line; ours is 16 px at 1.3, so a
 *  page we cut at twelve of our lines comes out as fifteen of the firmware's -
 *  405 pixels in a 288 pixel panel, five lines off the bottom. Paged our way,
 *  a third of every page in text mode would simply not be shown.
 *
 *  So the pages are cut by the firmware's own measure, taken from
 *  `@evenrealities/pretext`, which models the LVGL shaping the glasses do and
 *  is checked against real hardware. What stays shared is everything that
 *  matters: a page is still a `Page` with `from` and `to`, so the position map,
 *  `pageAt`, the page each note was left on and the whole of `session.ts` do
 *  not know or care which pager made it. */

import { measureTextWrap } from '@evenrealities/pretext'
import { blocksOf, type BlockOptions } from './blocks'
import { hashOf } from './hash'
import type { Page } from './layout'
import { MARGIN_X, PANEL_HEIGHT, PANEL_WIDTH } from './panel'
import type { Run } from './runs'

/** The firmware's own line, in pixels. Fixed, and not ours to choose. */
const FIRMWARE_LINE = 27

/** What the panel gives text to sit in. */
const INNER = PANEL_WIDTH - 2 * MARGIN_X

/** How many of the firmware's lines a panel holds. Ten, against the twelve our
 *  own layout fits, which is the whole reason this file exists. */
export const TEXT_ROWS = Math.floor(PANEL_HEIGHT / FIRMWARE_LINE)

/** The words of a run, with a ligature glyph put back as the characters it
 *  stands for: the firmware has no such glyph and would draw a blank. */
function wordsOfRun(run: Run): string {
  if (run.math) return run.math.tex
  return run.over ?? run.text
}

function wordsOfRuns(runs: readonly Run[]): string {
  return runs.map(wordsOfRun).join('')
}

/** One line of the note, and where in the file it began. */
interface Sentence {
  text: string
  from: number
}

/** A block as the lines the firmware will be given.
 *
 *  Everything that cannot be drawn becomes what it says instead: a formula is
 *  its own source, a table is its rows with the cells spaced apart, a picture is
 *  the words it was described as. Nothing is dropped, because a reader in text
 *  mode has chosen speed and not silence. */
function sentencesOf(block: ReturnType<typeof blocksOf>[number]): Sentence[] {
  const at = block.from

  switch (block.kind) {
    case 'heading':
      // The firmware has one size, so a heading is marked the way it is written.
      return [{ text: `${'#'.repeat(block.level)} ${wordsOfRuns(block.runs)}`, from: at }]
    case 'text':
      return [{ text: wordsOfRuns(block.runs), from: at }]
    case 'item':
      return [{ text: `${wordsOfRuns(block.marker)}${wordsOfRuns(block.runs)}`, from: at }]
    case 'code':
      return block.lines.map((line) => ({
        text: line.map((span) => span.text).join(''),
        from: at,
      }))
    case 'table':
      return [block.head, ...block.rows].map((row) => ({
        text: row.map((cell) => wordsOfRuns(cell)).join('   '),
        from: at,
      }))
    case 'math':
      return [{ text: block.tex, from: at }]
    case 'picture':
      return [{ text: block.alt || block.source, from: at }]
    case 'rule':
      return [{ text: '---', from: at }]
  }
}

/** How many of the firmware's lines a sentence takes on the panel. */
function rowsOf(text: string): number {
  // An empty line still takes one: it is the space between paragraphs.
  return text ? measureTextWrap(text, INNER).lineCount : 1
}

export interface TextPage extends Page {
  /** What the text container is given. Only this pager sets it. */
  words: string
}

/** Whether a page came from this pager rather than the drawn one. */
export function isTextPage(page: Page): page is TextPage {
  return typeof (page as { words?: unknown }).words === 'string'
}

/** A note as pages of words, cut where the firmware will cut them.
 *
 *  A sentence is never split across a page: it moves whole, exactly as a line
 *  does in the drawn layout, so a page break never lands inside a thought. A
 *  sentence longer than a whole page is the one exception, because something has
 *  to give and half of it on screen beats none of it. */
export function textPages(source: string, options: BlockOptions): TextPage[] {
  const blocks = blocksOf(source, options)
  const sentences = blocks.flatMap((block) => sentencesOf(block))

  const pages: TextPage[] = []
  let taken: Sentence[] = []
  let rows = 0

  const cut = (to: number) => {
    if (!taken.length) return

    const words = taken.map((one) => one.text).join('\n')
    pages.push({
      index: pages.length,
      from: taken[0]?.from ?? 0,
      to,
      lines: [],
      tops: [],
      hash: hashOf(`t:${words}`),
      words,
    })
    taken = []
    rows = 0
  }

  for (const sentence of sentences) {
    const wants = rowsOf(sentence.text)
    if (rows && rows + wants > TEXT_ROWS) cut(sentence.from)

    taken.push(sentence)
    rows += wants

    // Longer than a page on its own: it takes the page it started and the next
    // sentence begins a new one.
    if (rows >= TEXT_ROWS) cut(sentence.from + sentence.text.length)
  }

  cut(source.length)
  return pages
}
