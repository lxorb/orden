import { describe, expect, test, vi } from 'vitest'
import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  parsed,
  recordOf,
  stored,
  stringList,
} from './stored'

describe('parsing what storage holds', () => {
  test('reads plain JSON', () => {
    expect(parsed('{"a":1}')).toEqual({ a: 1 })
  })

  test('answers null for nothing written', () => {
    expect(parsed(null)).toBeNull()
  })

  test('answers null rather than throwing on a truncated entry', () => {
    expect(parsed('{"a":')).toBeNull()
    expect(parsed('')).toBeNull()
  })
})

describe('reading a key', () => {
  test('comes back parsed', () => {
    const store = new Map([['k', '[1,2]']])
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null })

    expect(stored('k')).toEqual([1, 2])
    expect(stored('missing')).toBeNull()
  })

  test('survives a browser that refuses storage outright', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('site data is blocked')
      },
    })

    expect(stored('k')).toBeNull()
  })
})

describe('the checks', () => {
  test('a record is an object that is neither null nor a list', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord([])).toBe(false)
    expect(isRecord('x')).toBe(false)
  })

  test('a list of strings comes back whole, or not at all', () => {
    expect(stringList(['a', 'b'])).toEqual(['a', 'b'])
    expect(stringList([])).toEqual([])
    expect(stringList(['a', 2])).toBeNull()
    expect(stringList({ 0: 'a' })).toBeNull()
    expect(stringList(null)).toBeNull()
  })

  test('a record drops the entries that do not fit and keeps the rest', () => {
    expect(recordOf({ a: 'one', b: 2, c: 'three' }, isString)).toEqual({ a: 'one', c: 'three' })
    expect(recordOf({ a: true, b: 'no' }, isBoolean)).toEqual({ a: true })
    expect(recordOf(['a'], isString)).toEqual({})
    expect(recordOf(null, isString)).toEqual({})
  })

  test('a number has to be a real one', () => {
    expect(isNumber(3)).toBe(true)
    expect(isNumber(Number.NaN)).toBe(false)
    expect(isNumber(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isNumber('3')).toBe(false)
  })
})
