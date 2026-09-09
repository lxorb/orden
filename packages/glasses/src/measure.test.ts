import { describe, expect, test } from 'vitest'
import { fold, width, wrap } from './firmware'
import { markLines } from './mark'
import { pagesOf } from './pages'
import { BODY_INNER, BODY_ROWS } from './panel'

/** What text mode costs, said out loud.
 *
 *  Kept as one test that prints rather than as assertions on a wall clock: the numbers
 *  are what the report quotes, and a suite running seven packages at once measures the
 *  queue in front of it as much as the work. The assertions that hold the speed are in
 *  `pages.test.ts`, and they are ratios. */
describe('what text mode costs', () => {
  const NUMS = 48
  const paging = { breakAt: 2, gutter: NUMS, inner: BODY_INNER - NUMS - 6, rows: BODY_ROWS }

  const note = Array.from(
    { length: 160 },
    (_one, at) =>
      `## Section ${at}\n\nProse about section ${at}, long enough to wrap across the panel more than once and then some.\n\n- a point\n- another point\n\n`,
  ).join('')

  const worstOf = (rounds: number, work: (round: number) => unknown) => {
    let worst = 0
    let total = 0
    for (let round = 0; round < rounds; round++) {
      const at = performance.now()
      work(round)
      const took = performance.now() - at
      worst = Math.max(worst, took)
      total += took
    }

    return { worst, mean: total / rounds }
  }

  test('measured', () => {
    const typed = (round: number) =>
      note.replace('Prose about section 7,', `Prose about section 7${'x'.repeat(round)},`)

    const cold = worstOf(5, (round) => pagesOf(typed(round + 5000), paging))
    const warm = worstOf(50, (round) => pagesOf(typed(round), paging))
    const marked = worstOf(20, () => markLines(note, { inner: paging.inner }))
    const folding = worstOf(200, () => fold(note.slice(0, 2700)))
    const wrapped = worstOf(200, () => wrap(`x${'word '.repeat(40)}`, paging.inner))

    const all = pagesOf(note, paging)
    const rows = all.reduce((sum, page) => sum + page.words.split('\n').length, 0)

    console.log(
      [
        '',
        `note                     ${String(note.length)} characters, ${String(all.length)} pages, ${String(rows)} rows`,
        `a cold page of it        ${cold.mean.toFixed(1)} ms mean, ${cold.worst.toFixed(1)} ms worst`,
        `a keystroke              ${warm.mean.toFixed(2)} ms mean, ${warm.worst.toFixed(2)} ms worst`,
        `marking it into lines    ${marked.mean.toFixed(1)} ms`,
        `folding 2,700 characters ${folding.mean.toFixed(3)} ms`,
        `wrapping one line        ${wrapped.mean.toFixed(4)} ms`,
        `a rule of 28 glyphs      ${String(width('─'.repeat(28)))} px of the ${String(BODY_INNER)} the body has`,
        '',
      ].join('\n'),
    )

    expect(all.length).toBeGreaterThan(100)
  })
})
