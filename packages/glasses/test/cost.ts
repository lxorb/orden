import { workDone as firmwareWork } from '../src/firmware'
import { type Paging, workDone as pagingWork } from '../src/pages'
import { BODY_INNER, BODY_ROWS, GUTTER } from '../src/panel'

/** The note the two cost suites both page, and the shape they page it in.
 *
 *  One copy, because measure.test.ts prints the numbers docs/even.md is written
 *  from and pages.test.ts asserts the property they rest on: two files measuring
 *  two different notes in two different panels are two files that cannot be read
 *  against each other. They had drifted - one paged a body fifty four pixels
 *  narrower than the glasses do, having taken the line-number column off the width
 *  that `pagesOf` takes it off itself. */

/** Two hundred-odd sections: a heading, a paragraph and a list of two, which is
 *  about twenty thousand characters and some five hundred lines of panel. */
export const NOTE = Array.from(
  { length: 160 },
  (_one, at) =>
    `## Section ${at}\n\nProse about section ${at}, long enough to wrap across the panel more than once and then some.\n\n- a point\n- another point\n\n`,
).join('')

/** How the reader's settings reach the pager, as the app sends them: the whole
 *  width of the body and the line-number column beside it. `pagesOf` takes the
 *  column off the width itself. */
export const PAGING: Paging = {
  breakAt: 2,
  gutter: GUTTER,
  inner: BODY_INNER,
  rows: BODY_ROWS,
}

/** The note with one line of it rewritten, which is what a keystroke is. The same
 *  length every round, so what differs between two rounds is which line changed
 *  and nothing else at all.
 *
 *  `mark` keeps one caller's rounds clear of another's: a line that has been broken
 *  once is answered out of the cache rather than broken again, so a test counting
 *  breaks has to type a line nothing has typed yet. */
export function typed(round: number, mark = ''): string {
  return NOTE.replace(
    'Prose about section 7,',
    `Prose about section ${mark}${String(round).padStart(4, '0')},`,
  )
}

/** What one piece of work asked of the firmware and of the pager, with whatever
 *  an earlier round left counted dropped first. */
export function costOf(work: () => unknown): {
  set: ReturnType<typeof firmwareWork>
  paged: ReturnType<typeof pagingWork>
} {
  firmwareWork()
  pagingWork()
  work()
  return { set: firmwareWork(), paged: pagingWork() }
}
