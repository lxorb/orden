import { describe, expect, test } from 'vitest'
import { formatRunValues } from './format'

const line = (...values: unknown[]) => formatRunValues(values)
const value = (held: unknown) => formatRunValues([held], true)
describe('formatting what the sandbox says', () => {
  test('writes strings as words and joins the arguments with a space', () => {
    expect(line('hi', 'there')).toBe('hi there')
  })
  test.each([
    ['hi', "'hi'"],
    ["it's\nhere", "'it\\'s\\nhere'"],
  ])('%s', (input, wanted) => expect(value(input)).toEqual(wanted))
  test.each([
    [undefined, 'undefined'],
    [null, 'null'],
    [true, 'true'],
    [Number.NaN, 'NaN'],
    [Infinity, 'Infinity'],
    [-0, '-0'],
    [10n, '10n'],
    [Symbol('tag'), 'Symbol(tag)'],
    [{ a: 1, b: 'x' }, "{ a: 1, b: 'x' }"],
    [[1, 'two', null], "[1, 'two', null]"],
    [{}, '{}'],
    [[], '[]'],
    [{ 'two words': 1 }, "{ 'two words': 1 }"],
    [new Map([['a', 1]]), "Map(1) { 'a' => 1 }"],
    [new Set([1, 2]), 'Set(2) { 1, 2 }'],
    [new Map(), 'Map(0) {}'],
    [new TypeError('nope'), 'TypeError: nope'],
    [new Error(''), 'Error'],
    [new Date(0), '1970-01-01T00:00:00.000Z'],
    [new Date(Number.NaN), 'Invalid Date'],
    [/ab+c/gi, '/ab+c/gi'],
    [{ a: { b: { c: { d: 1 } } } }, '{ a: { b: { c: [Object] } } }'],
    [[[[[1]]]], '[[[[Array]]]]'],
  ])('%s', (input, wanted) => expect(line(input)).toEqual(wanted))
  test('names the class an object came from', () => {
    class Point {
      constructor(
        readonly x: number,
        readonly y: number,
      ) {}
    }
    expect(line(new Point(1, 2))).toBe('Point { x: 1, y: 2 }')
  })
  test('names functions and classes without printing their bodies', () => {
    function named() {
      return undefined
    }
    class Thing {
      readonly kind = 'thing'
    }
    expect(line(named)).toBe('[Function: named]')
    expect(line(() => 1)).toBe('[Function (anonymous)]')
    expect(line(Thing)).toBe('[class Thing]')
  })
  test('stops at a cycle instead of following it', () => {
    const holder: Record<string, unknown> = { name: 'a' }
    holder.self = holder
    expect(line(holder)).toBe("{ name: 'a', self: [Circular] }")
  })
  test('lets the same value appear twice side by side', () => {
    const shared = { a: 1 }
    expect(line({ one: shared, two: shared })).toBe('{ one: { a: 1 }, two: { a: 1 } }')
  })
  test('counts the items it left out of a long array', () => {
    const many = Array.from({ length: 103 }, (_, index) => index)
    expect(formatRunValues([many])).toContain('… 3 more]')
  })
  test('clips a string that would fill the panel on its own', () => {
    const long = 'x'.repeat(600)
    const shown = value(long)
    expect(shown.length).toBeLessThan(420)
    expect(shown.endsWith("…'")).toBe(true)
  })
  test('needs nothing from outside itself', () => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- evaluating the embedded copy in an empty scope is the whole test
    const build = new Function(`return (${String(formatRunValues)})`) as () => typeof formatRunValues
    const alone = build()
    expect(alone([{ a: [1, 'two'] }])).toBe("{ a: [1, 'two'] }")
    expect(alone([new Error('boom')])).toBe('Error: boom')
  })
})
