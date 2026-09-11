/** A note as pages the glasses set themselves.
 *
 *  Ten of the firmware's 27 pixel lines fit on the panel and the page keeps three
 *  of them for its own furniture, so a page of a note is seven lines; see
 *  `panel.ts`. This decides which seven.
 *
 *  Three rules, and the first is the one worth reading twice:
 *
 *  1. **A page starts at a heading.** Which heading is the reader's own choice,
 *     H2 and above by default. It is what makes the glasses read as a document
 *     rather than as a scroll: a section begins at the top of a panel, and its
 *     heading then sits in the head band for every page of it, so looking up
 *     always says where you are.
 *  2. **A line is never split across a page.** A row that only exists because
 *     the line before it ran out of room, the body of a fence, the rows of a
 *     table, the first line under a heading: each moves whole.
 *  3. **A page is cut by the firmware's own measure.** The lines are wrapped
 *     here rather than by the container, so a page holds exactly the rows the
 *     panel has and never one more, and paging is arithmetic rather than a
 *     prediction about somebody else's text engine.
 *
 *  Every page carries `from` and `to`, where it begins and ends in the note. That
 *  is what keeps a reader in place when the note is edited under them, what binds
 *  the glasses to the phone's own scroll in both directions, and what the frame
 *  drawn in the plugin is drawn around. */

import { fit, fold, rightward, SPACE, width, wrap } from './firmware'
import { hashOf } from './hash'
import type { Compaction, Marks } from './mark'
import { hangOf, type Line, markLines } from './mark'

/** How the reader wants a note paged. Their settings, straight through. */
export interface Paging {
  /** A new page at every heading of this level or above. Two is "H2 and above",
   *  which is the default; zero for a note that runs on without breaks. */
  breakAt: number
  /** How wide the column of line numbers is, in pixels, or zero for no numbers.
   *
   *  A width rather than a switch, because the numbers are a container of their own
   *  laid over the left of the body, and the note's rows are pushed in by this much
   *  to clear it. See `panel.ts` for why they cannot live in the body's own text. */
  gutter: number
  /** How wide the body container is, in pixels. */
  inner: number
  /** How many of the firmware's lines the body container holds. */
  rows: number
  /** Which of a note's markers are drawn, and how much of its white space
   *  reaches the panel. The reader's own settings, straight through to the
   *  mapping; see `mark.ts`. */
  marks?: Marks
  compaction?: Compaction
  rootIndent?: boolean
}

/** One page of a note, ready for the bands of the panel. */
export interface Page {
  /** Counting from zero. */
  index: number
  /** Where in the note the page begins and ends, counted from the first byte of
   *  the file with the front matter included. */
  from: number
  to: number
  /** What the page is, in one short string. Two pages that hash alike are the
   *  same page, which is how an edit that moves nothing sends nothing. */
  hash: string
  /** What the body container is given: at most `rows` lines, already wrapped. */
  words: string
  /** What the column of line numbers is given: one line for every line of
   *  `words`, blank where a row is the continuation of the line above it. Empty
   *  when the reader asked for no numbers. */
  numbers: string
  /** The heading this page sits under, set for the head band. Empty at the top of
   *  a note that begins without one, and the panel then says the note's name. */
  section: string
  /** What the rule under the head is made of: heavy under a first level heading,
   *  light under anything else. */
  rule: string
  /** The first and the last line of the note this page shows. */
  firstLine: number
  lastLine: number
}

/** The glyphs a head rule is drawn with, by the level of the heading over it. */
const HEAVY = '═'
const LIGHT = '─'

/** A line, and the rows it takes. Wrapped once for the whole note, so the paging
 *  below is arithmetic and a note is measured once however many pages it makes. */
interface Wrapped {
  line: Line
  rows: readonly string[]
}

/** A page being filled. */
interface Taking {
  taken: Wrapped[]
  rows: number
  section: string
  rule: string
}

function empty(section: string, rule: string): Taking {
  return { taken: [], rows: 0, section, rule }
}

/** What paging a note did, counted.
 *
 *  Counted rather than timed, for the reason `Work` in firmware.ts gives beside its
 *  own counts: pages.test.ts asked for a re-page in under 60 ms and measure.test.ts
 *  timed two hundred and seventy five of them, and a wall clock in a suite running
 *  seven packages at once measures the queue in front of the work as much as the
 *  work. These two are the same numbers on a busy machine as on an idle one, and
 *  with the firmware's own counts beside them they say the whole of what a keystroke
 *  costs: the same lines walked, the same pages cut, and one of them broken again. */
export interface Work {
  /** Pages cut. */
  pages: number
  /** Lines of the note walked into them. */
  lines: number
}

function nothing(): Work {
  return { pages: 0, lines: 0 }
}

const work = nothing()

/** What the paging since this was last asked did, and zero from here. */
export function workDone(): Work {
  const done = { ...work }
  Object.assign(work, nothing())
  return done
}

/** A note as pages, cut where the firmware will cut them. */
export function pagesOf(source: string, paging: Paging): Page[] {
  const marked = markLines(source, {
    inner: paging.inner,
    ...(paging.marks ? { marks: paging.marks } : {}),
    ...(paging.compaction ? { compaction: paging.compaction } : {}),
    ...(paging.rootIndent === undefined ? {} : { rootIndent: paging.rootIndent }),
  })
  if (!marked.length) return []

  // A constant indent rather than a padded number: constant is what has no jitter
  // in it, and it is what lets every screen that is not a note keep the whole width
  // of the panel. See `panel.ts`.
  const indent = ' '.repeat(paging.gutter > 0 ? Math.ceil(paging.gutter / SPACE) : 0)
  // One space of slack, because the font kerns: a row wrapped to exactly what is
  // left is a row that measures a pixel over once the indent is in front of it, and
  // a pixel over is a row the container wraps.
  const inner = paging.inner - width(indent) - (indent === '' ? 0 : SPACE)
  const pages: Page[] = []
  let taking = empty('', LIGHT)

  const cut = (to: number) => {
    if (!taking.taken.length) return

    const first = taking.taken[0]?.line
    const shown: string[] = []
    const counted: string[] = []
    for (const { line, rows } of taking.taken) {
      for (const [at, row] of rows.entries()) {
        shown.push(indent + row)
        // Only the first row of a line carries its number: the rest are the same
        // line of the note, and saying so twice is a lie about where you are.
        if (indent !== '') {
          // Against the right of its own column, whatever its digits, with a space
          // kept clear on either side so a number can never touch a word.
          const room = paging.gutter - SPACE * 2
          counted.push(at === 0 ? rightward(fit(String(line.at), room), room) : '')
        }
      }
    }

    const words = shown.join('\n')
    const numbers = counted.join('\n')
    work.pages += 1
    pages.push({
      index: pages.length,
      from: first?.from ?? 0,
      to,
      hash: hashOf(`${taking.section}|${taking.rule}|${numbers}|${words}`),
      words,
      numbers,
      section: taking.section,
      rule: taking.rule,
      firstLine: first?.at ?? 1,
      lastLine: taking.taken.at(-1)?.line.at ?? 1,
    })
  }

  /** The run at the end of what has been taken that has to move with `coming`.
   *
   *  Nothing, unless `coming` is glued to the line above it - and then the whole
   *  run it belongs to: every trailing glued line, and the line they all hang off.
   *  That last one is the point. A fence whose opening line is at the foot of a
   *  page and whose body is at the head of the next is exactly the break this
   *  rule exists to prevent, and the opening line is not itself glued to
   *  anything. */
  const runFor = (coming: Line): Wrapped[] => {
    if (!coming.glued) return []

    let back = 0
    while (back < taking.taken.length && taking.taken.at(-1 - back)?.line.glued === true) back++
    // The whole page is one run - a fence longer than the panel, say. Something
    // has to give, and the foot of the page is the least bad place for it. Moving
    // the run would move the whole page and make no progress at all.
    if (back + 1 >= taking.taken.length) return []

    return taking.taken.splice(-(back + 1))
  }

  for (const line of marked) {
    work.lines += 1
    // A heading at or above the reader's level opens a page of its own and goes
    // into the head band rather than into the body.
    if (paging.breakAt > 0 && line.level > 0 && line.level <= paging.breakAt) {
      cut(line.from)
      taking = empty(fold(line.text), line.level === 1 ? HEAVY : LIGHT)
      continue
    }

    // The underline `mark.ts` drew under that heading is the head band's own
    // rule, so it is not drawn a second time. Told apart by `under` rather than
    // by its shape: a note may perfectly well have a rule of its own there.
    if (taking.taken.length === 0 && taking.section !== '' && line.under) continue

    const rows = wrap(line.text, inner, hangOf(line.text))
    if (taking.rows > 0 && taking.rows + rows.length > paging.rows) {
      const moving = runFor(line)
      for (const one of moving) taking.rows -= one.rows.length

      cut(moving[0]?.line.from ?? line.from)
      taking = empty(taking.section, taking.rule)
      for (const one of moving) {
        taking.taken.push(one)
        taking.rows += one.rows.length
      }
    }

    taking.taken.push({ line, rows })
    taking.rows += rows.length
  }

  cut(source.length)
  return pages
}

/** Which page an offset in the note falls on.
 *
 *  What keeps a reader in place when a note is rewritten under them, and what the
 *  phone's own scroll position is turned into. */
export function pageAt(pages: readonly Page[], offset: number): number {
  for (const page of pages) {
    if (offset < page.to) return page.index
  }

  return Math.max(0, pages.length - 1)
}

/** Which page a line of the note is on, for "go to line". */
export function pageOfLine(pages: readonly Page[], line: number): number {
  for (const page of pages) {
    if (line <= page.lastLine) return page.index
  }

  return Math.max(0, pages.length - 1)
}
