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

/** One place in the app writes to storage, and this is it.
 *
 *  Not a style rule. A `setItem` throws three ways - a browser told to keep no
 *  site data, a private window with a quota of nothing, a storage that is full -
 *  and an unguarded one turns any of them into an exception in the middle of
 *  whatever was going on. A full storage once failed a whole syncing pass that
 *  way, and with it the cursor the pass had just moved; see `save` in
 *  sync.svelte.ts. What is lost when a write fails is a cache, never the state,
 *  which is in memory and true - so a store's method must not be able to throw
 *  over one.
 *
 *  Read off the source rather than written down, for the same reason i18n.test.ts
 *  reads the strings the app asks for: a list would go stale the first time
 *  somebody added a store. */
const SOURCE = fileURLToPath(new URL('..', import.meta.url))

/** The files still to convert, and who they are waiting for. The test names them
 *  rather than ignoring the folders they are in, so this list is a list of work
 *  left and gets shorter rather than older.
 *
 *  One left, and it is the odd one. The site script is the handful of lines a
 *  published page runs, bundled from these modules into the Worker
 *  (`services/sync/src/blog/script.ts`): importing this module there would pull
 *  the app's log into a public page to guard one write of the reader's own theme
 *  choice, which is a worse trade than the guard is worth. It writes inside a try
 *  of its own, and says so where it does. */
const LEFT = ['site/site.ts']

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) sourceFiles(path, found)
    else if (/\.(ts|svelte)$/.test(name) && !name.endsWith('.test.ts')) found.push(path)
  }

  return found
}

/** The module under test, which is the one place that may write. */
const HERE = fileURLToPath(new URL('./stored.ts', import.meta.url))

/** Every file that writes to storage itself, as a path under `src`. A test may:
 *  it stands in for a browser rather than being one. */
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

/** Every file that reads storage itself, the same way round.
 *
 *  Reading throws one of the three ways writing does - a browser told to allow no
 *  site data refuses the getter as well - and fourteen modules had either written
 *  that try/catch out again or left it off. `storedText` is the one read, and this
 *  is what keeps it the one read. */
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
