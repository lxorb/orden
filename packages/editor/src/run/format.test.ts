import { describe, expect, test } from 'vitest'
import { formatRunValues } from './format'

/** How a console line reads: the strings as written, everything else described. */
const line = (...values: unknown[]) => formatRunValues(values)

/** How a result value reads, where a string is a value and says so. */
const value = (held: unknown) => formatRunValues([held], true)

describe('formatting what the sandbox says', () => {
  test('writes strings as words and joins the arguments with a space', () => {
    expect(line('hi', 'there')).toBe('hi there')
  })

  test('quotes a string that is a value rather than a message', () => {
    expect(value('hi')).toBe("'hi'")
  })

  test('escapes what would make a quoted string ambiguous', () => {
    expect(value("it's\nhere")).toBe("'it\\'s\\nhere'")
  })

  test('names the values that have no text of their own', () => {
    expect(line(undefined)).toBe('undefined')
    expect(line(null)).toBe('null')
    expect(line(true)).toBe('true')
    expect(line(Number.NaN)).toBe('NaN')
    expect(line(Infinity)).toBe('Infinity')
    expect(line(-0)).toBe('-0')
    expect(line(10n)).toBe('10n')
    expect(line(Symbol('tag'))).toBe('Symbol(tag)')
  })

  test('describes objects and arrays by their contents', () => {
    expect(line({ a: 1, b: 'x' })).toBe("{ a: 1, b: 'x' }")
    expect(line([1, 'two', null])).toBe("[1, 'two', null]")
    expect(line({})).toBe('{}')
    expect(line([])).toBe('[]')
  })

  test('quotes a key that is not a plain name', () => {
    expect(line({ 'two words': 1 })).toBe("{ 'two words': 1 }")
  })

  test('names the class an object came from', () => {
    class Point {
      constructor(
        readonly x: number,
        readonly y: number,
      ) {}
    }
    expect(line(new Point(1, 2))).toBe('Point { x: 1, y: 2 }')
  })

  test('says how many a map or a set holds', () => {
    expect(line(new Map([['a', 1]]))).toBe("Map(1) { 'a' => 1 }")
    expect(line(new Set([1, 2]))).toBe('Set(2) { 1, 2 }')
    expect(line(new Map())).toBe('Map(0) {}')
  })

  test('reads an error as the sentence it is', () => {
    expect(line(new TypeError('nope'))).toBe('TypeError: nope')
    expect(line(new Error(''))).toBe('Error')
  })

  test('keeps dates and patterns in the form they are written in', () => {
    expect(line(new Date(0))).toBe('1970-01-01T00:00:00.000Z')
    expect(line(new Date(Number.NaN))).toBe('Invalid Date')
    expect(line(/ab+c/gi)).toBe('/ab+c/gi')
  })

  test('names functions and classes without printing their bodies', () => {
    expect(line(function named() {})).toBe('[Function: named]')
    expect(line(() => 1)).toBe('[Function (anonymous)]')
    expect(line(class Thing {})).toBe('[class Thing]')
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

  test('stops descending once nesting gets deep', () => {
    expect(line({ a: { b: { c: { d: 1 } } } })).toBe('{ a: { b: { c: [Object] } } }')
    expect(line([[[[1]]]])).toBe('[[[[Array]]]]')
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
    // The sandbox gets this function as source text, so anything it referred to
    // in this module would be undefined by the time it runs there. Evaluating
    // the same text in an empty scope is the check.
    const alone = new Function(`return (${String(formatRunValues)})`)() as typeof formatRunValues
    expect(alone([{ a: [1, 'two'] }])).toBe("{ a: [1, 'two'] }")
    expect(alone([new Error('boom')])).toBe('Error: boom')
  })
})
