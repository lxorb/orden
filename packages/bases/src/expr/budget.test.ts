import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { answer, cellValue } from '../answer'
import { inBase } from '../automations'
import { readBase } from '../base-file'
import { contextAt, noteRow } from '../fixtures/rows'
import type { Base } from '../types'

/** A guarded base may not take the app with it, whatever it asks for: a pattern is
 *  only one way to spend a second. The steps are counted, so none of this asks a clock. */

const LIST = '[1,2,3,4,5,6,7,8,9,10]'
const nested = (depth: number): string => (depth === 0 ? '1' : `${LIST}.map(${nested(depth - 1)})`)

const context = contextAt()
const row = noteRow('a.md', { x: 'aaaa' })

const baseWith = (filter: string, guarded?: boolean): Base => ({
  ...readBase(`filters: '${filter}'\nviews:\n  - type: table\n    name: T\n`),
  ...(guarded ? { guarded } : {}),
})

const formula = (source: string, guarded?: boolean) =>
  cellValue(
    {
      ...readBase(`formulas:\n  f: '${source}'\nviews:\n  - type: table\n    name: T\n`),
      ...(guarded ? { guarded } : {}),
    },
    'formula.f',
    row,
    context,
  )

describe('how much one evaluation of a guarded base may take', () => {
  /** Each test on a second of its own. */
  let second = 0
  beforeEach(() => {
    second += 10_000
    vi.useFakeTimers({ toFake: ['performance'] })
    vi.advanceTimersByTime(second)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('nested lists past the budget answer nothing for that row', () => {
    const filter = `(${nested(6)}) != 12345`
    expect(answer(baseWith(filter, true), 0, [row], context).total).toBe(0)
    expect(inBase(baseWith(filter, true), row, context)).toBe(false)
    expect(formula(nested(6), true)).toBeNull()
  })

  test('a base of the reader is not limited at all', () => {
    const filter = `(${nested(5)}) != 12345`
    expect(answer(baseWith(filter), 0, [row], context).total).toBe(1)
    expect(inBase(baseWith(filter), row, context)).toBe(true)
  })

  test('a string or a list that grows past the budget is not built', () => {
    expect(formula('"a".repeat(30000000).length', true)).toBeNull()
    expect(formula('"abc".repeat(5000000000)', true)).toBeNull()
    expect(formula('"a".repeat(1000000).split("").length', true)).toBeNull()
    expect(formula('"a".repeat(1000000).replace("a", "bbbbbbbbbbbbbbbb").length', true)).toBeNull()
    expect(
      formula(
        '[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40].reduce(acc + acc, "x").length',
        true,
      ),
    ).toBeNull()
    // Asked of itself over a long list, which is every item against every other.
    expect(formula('"a".repeat(90000).split("").unique().length', true)).toBeNull()
  })

  test('what a base really asks for is well inside it', () => {
    expect(formula('"abc".repeat(1000).length', true)).toBe(3000)
    expect(formula('"a,b,c".split(",").map(value.upper()).join("")', true)).toBe('ABC')
    expect(formula(`${LIST}.map(${LIST}.map(value * 2)).flat().sum()`, true)).toBe(1100)
    expect(formula('"a".repeat(5000).split("").map(index).length', true)).toBe(5000)
    expect(formula('"a".repeat(500).split("").unique().length', true)).toBe(1)
  })

  test('a row past it leaves the next row its own budget', () => {
    const base = {
      ...readBase(
        `formulas:\n  f: 'if(note.deep, ${nested(6)}, 7)'\nviews:\n  - type: table\n    name: T\n`,
      ),
      guarded: true,
    }
    expect(cellValue(base, 'formula.f', noteRow('a.md', { deep: true }), context)).toBeNull()
    expect(cellValue(base, 'formula.f', noteRow('b.md', { deep: false }), context)).toBe(7)
  })

  test('a thousand rows just under it are stopped as well, and go on the next second', () => {
    // About nine thousand steps a row.
    const under = `(${nested(4)}).length == 10`
    const rows = Array.from({ length: 1000 }, (_, at) => noteRow(`n${at}.md`, {}))
    const first = answer(baseWith(under, true), 0, rows, context).total
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(1000)

    vi.advanceTimersByTime(1000)
    expect(answer(baseWith(under, true), 0, rows.slice(0, 5), context).total).toBe(5)
  })
})
