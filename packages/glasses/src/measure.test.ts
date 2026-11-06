import { describe, expect, test } from 'vitest'
import { fold, width, wrap } from './firmware'
import { markLines } from './mark'
import { pagesOf } from './pages'
import { BODY_INNER } from './panel'
import { costOf, NOTE as note, PAGING as paging, typed } from '../test/cost'

describe('what text mode costs', () => {
  test('measured', () => {
    const cold = costOf(() => pagesOf(typed(1), paging))
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

    expect(warm.paged).toEqual(cold.paged)
    expect(cold.paged.lines).toBeGreaterThan(700)

    expect(cold.set.broken).toBeGreaterThan(100)
    expect(warm.set.broken).toBe(1)
    expect(warm.set.cached).toBe(cold.set.broken + cold.set.cached - 1)
    expect(warm.set.measured * 2).toBeLessThan(cold.set.measured)

    expect(marked.set.broken).toBe(0)
    expect(folding.set.measured).toBe(0)
    expect(folding.set.folded).toBe(2700)
    expect(wrapped.set.broken).toBe(1)
  })
})
