import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test, vi } from 'vitest'
import {
  forget,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  keep,
  parsed,
  recordOf,
  stored,
  storedText,
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

describe('reading a key as the word it was written as', () => {
  test('comes back as it went in', () => {
    const store = new Map([['k', 'yes']])
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null })

    expect(storedText('k')).toBe('yes')
    expect(storedText('missing')).toBeNull()
  })

  test('survives a browser that refuses storage outright', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('site data is blocked')
      },
    })

    expect(storedText('k')).toBeNull()
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

describe('writing one down', () => {
  test('says whether storage took it, and does not throw when it would not', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      setItem: (key: string, value: string) => {
        if (value.length > 8) throw new Error('quota exceeded')
        store.set(key, value)
      },
      removeItem: (key: string) => store.delete(key),
    })

    expect(keep('k', 'small')).toBe(true)
    expect(keep('k', 'a value too long for this storage')).toBe(false)
    expect(store.get('k')).toBe('small')
  })

  test('and forgetting one is quiet whatever storage does', () => {
    vi.stubGlobal('localStorage', {
      removeItem: () => {
        throw new Error('site data is blocked')
      },
    })

    expect(() => forget('k')).not.toThrow()
  })
})

const SOURCE = fileURLToPath(new URL('../../..', import.meta.url))

const LEFT = ['site/site.ts']

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) sourceFiles(path, found)
    else if (/\.(ts|svelte)$/.test(name) && !name.endsWith('.test.ts')) found.push(path)
  }

  return found
}

const HERE = join(import.meta.dirname, './stored.ts')

function writesItself(): string[] {
  const writing = /localStorage\.(setItem|removeItem|clear)\(/

  return sourceFiles(SOURCE)
    .filter((path) => path !== HERE)
    .filter((path) => writing.test(readFileSync(path, 'utf8')))
    .map((path) => path.slice(SOURCE.length).replace(/\\/g, '/'))
    .sort()
}

describe('who writes to storage', () => {
  test('is this module, and the few files still waiting on another pass', () => {
    expect(writesItself()).toEqual(LEFT)
  })
})

function readsItself(): string[] {
  return sourceFiles(SOURCE)
    .filter((path) => path !== HERE)
    .filter((path) => readFileSync(path, 'utf8').includes('localStorage.getItem('))
    .map((path) => path.slice(SOURCE.length).replace(/\\/g, '/'))
    .sort()
}

describe('who reads storage', () => {
  test('is this module, and the site script for the reason above', () => {
    expect(readsItself()).toEqual(LEFT)
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
