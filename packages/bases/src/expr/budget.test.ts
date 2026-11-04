import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { answer, cellValue } from '../answer'
import { inBase, rowsInBase } from '../automations'
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
    const filter = `(${nested(7)}) != 12345`
    expect(answer(baseWith(filter, true), 0, [row], context).total).toBe(0)
    expect(inBase(baseWith(filter, true), row, context)).toBe(false)
    expect(formula(nested(7), true)).toBeNull()
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

  test('a list made of itself costs what walking it costs, whoever walks it', () => {
    const steps = Array.from({ length: 22 }, (_, at) => at + 1).join(',')
    const bomb = (step: string, start = '0') => `[${steps}].reduce(${step}, ${start})`
    const list = bomb('[acc, acc]')
    expect(formula(`(${list} + "x").length`, true)).toBeNull()
    expect(formula(`${list}.toString().length`, true)).toBeNull()
    expect(formula(`${list}.flat().length`, true)).toBeNull()
    expect(formula(`[${list}].flat().length`, true)).toBeNull()
    expect(formula(`[${list}].join(",").length`, true)).toBeNull()
    expect(formula(`[${list}, 1, ${list}].sort().length`, true)).toBeNull()
    expect(formula(`(${list} == ${bomb('[acc, acc]')})`, true)).toBeNull()
    expect(formula(`list(${list}).length`, true)).toBe(2)
    expect(formula(`({"a": ${list}}).a.length`, true)).toBeNull()
    // Handed out as it is, it would be walked by whatever draws the cell.
    expect(formula(list, true)).toBeNull()
    // The same through an object, which `settled` leaves as it is.
    const objects = bomb('{"a": acc, "b": acc}')
    expect(formula(objects, true)).toBeNull()
    expect(formula(`(${objects} + "x").length`, true)).toBeNull()
    const said = answer(baseWith(`(${list} + "x").length > 0`, true), 0, [row], context)
    expect(said.total).toBe(0)
    expect(said.partial).toBe(true)
  })

  test('a list too deep to walk answers nothing', () => {
    const steps = 'x'.repeat(3000).split('').join('","')
    expect(formula(`["${steps}"].reduce([acc], 0)`, true)).toBeNull()
  })

  test('a long string asked for again and again costs its length each time', () => {
    const long = '"a".repeat(8000000)'
    const each = `"b".repeat(50000).split("").map(escapeHTML(${long}).length)`
    expect(formula(`${each}.length`, true)).toBeNull()
    // Written out in a list, or joined by.
    const items = Array.from({ length: 300 }, () => 'acc').join(',')
    expect(formula(`[1].reduce([${items}], ${long}).toString().length`, true)).toBeNull()
    expect(formula(`[1,2,3,4,5,6,7,8].join(${long}).length`, true)).toBeNull()
    expect(formula(`"aaaaaaaaaaaaaaaaaaaa".replace(/a/g, ${long}).length`, true)).toBeNull()
  })

  test('the words of a method run once per item, however many there are', () => {
    const big = Array.from({ length: 40000 }, (_, at) => at).join(',')
    const over = '"a".repeat(1000).split("")'
    expect(formula(`${over}.map([${big}]).length`, true)).toBeNull()
    const sum = Array.from({ length: 40000 }, () => '(1)').join('+')
    expect(formula(`${over}.map(${sum}).length`, true)).toBeNull()
  })

  test('what a base really asks for is well inside it', () => {
    expect(formula('"abc".repeat(1000).length', true)).toBe(3000)
    expect(formula('"a,b,c".split(",").map(value.upper()).join("")', true)).toBe('ABC')
    expect(formula(`${LIST}.map(${LIST}.map(value * 2)).flat().sum()`, true)).toBe(1100)
    expect(formula('"a".repeat(5000).split("").map(index).length', true)).toBe(5000)
    expect(formula('"a".repeat(500).split("").unique().length', true)).toBe(1)
    expect(formula('"a".repeat(50000).split("").join("-").length', true)).toBe(99999)
    expect(formula('("a".repeat(50000).split("") + "x").length', true)).toBe(149999)
    expect(formula('"a".repeat(50000).split("") == "a".repeat(50000).split("")', true)).toBe(true)
    expect(formula(`${LIST}.map(${LIST}.map(${LIST})).flat().length`, true)).toBe(1000)
    expect(formula(`[[[[[[1]]]]]].flat()`, true)).toEqual([1])
    expect(formula(`${LIST}.map({"a": value, "b": [value]})`, true)).toHaveLength(10)
    expect(formula('"a".repeat(1000000).length', true)).toBe(1000000)
  })

  test('a row past it leaves the next row its own budget', () => {
    const base = {
      ...readBase(
        `formulas:\n  f: 'if(note.deep, ${nested(7)}, 7)'\nviews:\n  - type: table\n    name: T\n`,
      ),
      guarded: true,
    }
    expect(cellValue(base, 'formula.f', noteRow('a.md', { deep: true }), context)).toBeNull()
    expect(cellValue(base, 'formula.f', noteRow('b.md', { deep: false }), context)).toBe(7)
  })

  test('ordinary work over many rows passes, however many there are', () => {
    const items = Array.from({ length: 500 }, (_, at) => at)
    const rows = Array.from({ length: 5000 }, (_, at) => noteRow(`n${at}.md`, { items }))
    const said = answer(baseWith('note.items.map(value + 1).length == 500', true), 0, rows, context)
    expect(said.total).toBe(5000)
    expect(said.partial).toBeUndefined()
  })

  test('a list too long for one spread still flattens, in a base of the reader', () => {
    const items = Array.from({ length: 200000 }, (_, at) => at)
    const rows = [noteRow('long.md', { items: [items] })]
    const said = answer(baseWith('note.items.flat().length == 200000'), 0, rows, context)
    expect(said.total).toBe(1)
  })

  test('a long list of a row, handed out as it is, is not refused', () => {
    const items = Array.from({ length: 100000 }, (_, at) => String(at))
    const base = {
      ...readBase(`formulas:\n  f: 'note.items'\nviews:\n  - type: table\n    name: T\n`),
      guarded: true,
    }
    expect(cellValue(base, 'formula.f', noteRow('a.md', { items }), context)).toHaveLength(100000)
  })

  test('a row past it makes the answer say it is partial', () => {
    const rows = [noteRow('a.md', { deep: true }), noteRow('b.md', { deep: false })]
    const base = baseWith(`if(note.deep, (${nested(7)}) != 1, true)`, true)
    const said = answer(base, 0, rows, context)
    expect(said.total).toBe(1)
    expect(said.partial).toBe(true)
    expect(
      answer(baseWith(`if(note.deep, (${nested(7)}) != 1, true)`), 0, rows.slice(1), context)
        .partial,
    ).toBeUndefined()
  })

  test('half of any second is what they may take together, and the next second is new', () => {
    // A clock that moves a tenth of a second each time it is asked.
    let now = 1e7
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => (now += 100))
    const under = '"a".repeat(10000).split("").length == 10000'
    const rows = Array.from({ length: 1000 }, (_, at) => noteRow(`n${at}.md`, {}))
    const first = answer(baseWith(under, true), 0, rows, context)
    expect(first.total).toBeGreaterThan(0)
    expect(first.total).toBeLessThan(1000)
    expect(first.partial).toBe(true)

    now += 2000
    clock.mockImplementation(() => now)
    expect(answer(baseWith(under, true), 0, rows.slice(0, 5), context).total).toBe(5)
    clock.mockRestore()
  })

  test('a count that is no number leaves the clock looking', () => {
    expect(formula('"a".repeat(0 / 0)', true)).toBeNull()
    let now = 2e7
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => (now += 100))
    const rows = Array.from({ length: 1000 }, (_, at) => noteRow(`n${at}.md`, {}))
    const said = answer(
      baseWith('"a".repeat(10000).split("").length == 10000', true),
      0,
      rows,
      context,
    )
    expect(said.total).toBeLessThan(1000)
    clock.mockRestore()
  })

  test('rows counted for an id say when the count cannot be trusted', () => {
    const rows = [noteRow('a.md', { deep: true }), noteRow('b.md', { deep: false })]
    const base = baseWith(`if(note.deep, (${nested(7)}) != 1, true)`, true)
    const own = rowsInBase(base, rows, context)
    expect(own.partial).toBe(true)
    expect(own.rows.map((one) => one.path)).toEqual(['b.md'])
    expect(rowsInBase(baseWith('note.deep == false'), rows, context).partial).toBe(false)
  })
})
