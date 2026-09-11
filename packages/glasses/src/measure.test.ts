import { describe, expect, test } from 'vitest'
import { fold, width, workDone as firmwareWork, wrap } from './firmware'
import { markLines } from './mark'
import { pagesOf, workDone as pagingWork } from './pages'
import { BODY_INNER, BODY_ROWS } from './panel'

/** What text mode costs, said out loud.
 *
 *  Counted rather than timed. This used to time two hundred and seventy five pagings
 *  of a long note to print their means, which on a runner with seven packages on it
 *  is most of a test timeout spent measuring the queue in front of the work. What is
 *  asserted now is `workDone` in firmware.ts and in pages.ts - the characters folded,
 *  the glyphs measured, the lines broken, the lines read out of the cache instead and
 *  the pages cut - and every one of those is the same number on a busy machine as on
 *  an idle one.
 *
 *  The report is still printed, because the numbers in docs/even.md are these ones,
 *  and the figures a reader wants from it are the two that matter: a cold page of a
 *  long note breaks every line of it, and the same note after a keystroke breaks one.
 *  The assertions that hold the speed round to that difference, and pages.test.ts
 *  holds it again from the other end. */
describe('what text mode costs', () => {
  const NUMS = 48
  const paging = { breakAt: 2, gutter: NUMS, inner: BODY_INNER - NUMS - 6, rows: BODY_ROWS }

  const note = Array.from(
    { length: 160 },
    (_one, at) =>
      `## Section ${at}\n\nProse about section ${at}, long enough to wrap across the panel more than once and then some.\n\n- a point\n- another point\n\n`,
  ).join('')

  /** The note with one line of it rewritten, which is what a keystroke is. The same
   *  length every round, so what differs between two of them is which line changed
   *  and nothing else. */
  const typed = (round: number) =>
    note.replace('Prose about section 7,', `Prose about section ${String(round).padStart(4, '0')},`)

  /** What one piece of work asked of the firmware and of the pager. */
  const costOf = (work: () => unknown) => {
    firmwareWork()
    pagingWork()
    work()
    return { set: firmwareWork(), paged: pagingWork() }
  }

  test('measured', () => {
    // A note this width has not been paged before, so every line of it is broken.
    const cold = costOf(() => pagesOf(typed(1), paging))
    // And the same note with one line of it changed, which is the keystroke.
    const warm = costOf(() => pagesOf(typed(2), paging))
    const marked = costOf(() => markLines(note, { inner: paging.inner }))
    const folding = costOf(() => fold(note.slice(0, 2700)))
    const wrapped = costOf(() => wrap(`x${'word '.repeat(40)}`, paging.inner))

    const all = pagesOf(note, paging)
    const rows = all.reduce((sum, page) => sum + page.words.split('\n').length, 0)

    const lines = (what: string, { set, paged }: ReturnType<typeof costOf>) =>
      `${what.padEnd(25)}${String(paged.pages)} pages, ${String(set.broken)} lines broken, ${String(set.cached)} from the cache, ${String(set.measured)} glyphs measured, ${String(set.folded)} folded`

    console.log(
      [
        '',
        `note                     ${String(note.length)} characters, ${String(all.length)} pages, ${String(rows)} rows`,
        lines('a cold page of it', cold),
        lines('a keystroke', warm),
        lines('marking it into lines', marked),
        lines('folding 2,700 characters', folding),
        lines('wrapping one line', wrapped),
        `a rule of 28 glyphs      ${String(width('─'.repeat(28)))} px of the ${String(BODY_INNER)} the body has`,
        '',
      ].join('\n'),
    )

    expect(all.length).toBeGreaterThan(100)

    // The whole of the note walked into pages, both times: a keystroke re-pages
    // from the top, and the saving is not in what it looks at.
    expect(warm.paged).toEqual(cold.paged)
    expect(cold.paged.lines).toBeGreaterThan(700)

    // The cold page breaks every distinct line of the note; the keystroke breaks
    // the one line that changed and is handed the rest back. That ratio is the
    // whole reason a keystroke fits inside a frame.
    expect(cold.set.broken).toBeGreaterThan(100)
    expect(warm.set.broken).toBe(1)
    expect(warm.set.cached).toBe(cold.set.broken + cold.set.cached - 1)
    // And measures a fraction of the glyphs, because measuring is what breaking a
    // line spends its time on.
    expect(warm.set.measured * 2).toBeLessThan(cold.set.measured)

    // Marking a note asks the metrics only what a heading rule and a table need;
    // folding asks them nothing at all.
    expect(marked.set.broken).toBe(0)
    expect(folding.set.measured).toBe(0)
    expect(folding.set.folded).toBe(2700)
    // One line, broken once.
    expect(wrapped.set.broken).toBe(1)
  })
})
