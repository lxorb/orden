import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  assetType,
  copyName,
  endingOf,
  fetchInTime,
  filledIn,
  folderOf,
  fromBase64,
  hiddenUnder,
  insideOnly,
  isNative,
  isReserved,
  keepJson,
  meet,
  mimeOfPath,
  nameFault,
  nameFromContent,
  nameOf,
  nameToWrite,
  normalise,
  parseDataUri,
  passing,
  platform,
  pollDelay,
  roomDelay,
  safeName,
  samePath,
  sha256,
  Shared,
  shownName,
  spaceOf,
  stored,
  storedText,
  toBase64,
  tokensOut,
  under,
  waited,
  within,
  withinSpace,
  withOrWithout,
} from '../src/api'
import { assetRoute, assetStorePath } from '../src/asset-route'
import { answeredCase } from '../src/space-paths'
import { afterQuiet, LATE } from '../src/timing'

const SRC = join(import.meta.dirname, '../src')

describe('the module stands on its own', () => {
  test('nothing under src reaches the shell by path, apart from the doors invoke opens', () => {
    const reaching = readdirSync(SRC)
      .filter((name) => !name.includes('.test.'))
      .flatMap((name) => {
        const text = readFileSync(join(SRC, name), 'utf8')
        return [...text.matchAll(/'(\.\.\/[^']*)'/g)].map((found) => `${name}: ${found[1]}`)
      })
    expect(reaching).toEqual([
      'tauri.ts: ../../crate/src/api',
      'tauri.ts: ../../web/commands',
      'tauri.ts: ../../internal/route',
      'tauri.ts: ../../crate/src/api',
    ])
  })

  test('loads outside the app as the web build: no native host, no platform name', () => {
    expect(isNative).toBe(false)
    expect(platform()).toBe('')
  })
})

describe('paths on disk', () => {
  afterEach(() => answeredCase('/s', null))

  test('two spellings are one path only where the file system folds case', () => {
    expect(samePath('/s/Notes/A.md', '/s/Notes/A.md')).toBe(true)
    expect(samePath('/s/Notes/A.md', '/s/notes/a.md')).toBe(false)
    answeredCase('/s', true)
    expect(samePath('/s/Notes/A.md', '/s/notes/a.md')).toBe(true)
    expect(samePath('/s/Notes/A.md', '/s/notes/b.md')).toBe(false)
  })

  test('a path inside a folder is told by its rest, outside by nothing', () => {
    expect(within('/s/Notes', '/s/Notes/deep/a.md')).toBe('deep/a.md')
    expect(within('/s/Notes', '/s/Notes')).toBe('')
    expect(within('/s/Notes', '/s/Other/a.md')).toBeNull()
    expect(within('/s/Notes', '/s/Notes2/a.md')).toBeNull()
    expect(withinSpace('/s', '/s/a/../b.md')).toBeNull()
    expect(withinSpace('/s', '/s/a/b.md')).toBe('a/b.md')
  })

  test('names and folders come off either separator', () => {
    expect(nameOf('C:\\Notes\\a.md')).toBe('a.md')
    expect(folderOf('/s/Notes/a.md')).toBe('/s/Notes')
  })

  test('a relative path typed by a caller stays inside the space', () => {
    expect(insideOnly('notes/./a.md')).toBe('notes/a.md')
    expect(insideOnly('../a.md')).toBeNull()
    expect(insideOnly('/etc/passwd')).toBeNull()
    expect(insideOnly('C:/x')).toBeNull()
    expect(insideOnly('con/a.md')).toBeNull()
    expect(insideOnly('a\u0000b')).toBeNull()
  })
})

describe('paths in the web store', () => {
  test('normalise folds separators, dots and doubled slashes', () => {
    expect(normalise('a//b/./c/../d\\e')).toBe('/a/b/d/e')
    expect(normalise('')).toBe('/')
  })

  test('under, hiddenUnder and spaceOf read the normalised path', () => {
    expect(under('/s', '/s/a.md')).toBe(true)
    expect(under('/s', '/sa/a.md')).toBe(false)
    expect(under('/', '/anything')).toBe(true)
    expect(hiddenUnder('/s', '/s/.git/x')).toBe(true)
    expect(hiddenUnder('/.s', '/.s/x')).toBe(false)
    expect(spaceOf('/s/a/b')).toBe('/s')
  })

  test('a safe name drops what a file system refuses', () => {
    expect(safeName(' a:b?c ')).toBe('a b c')
    expect(safeName('...')).toBeNull()
    expect(safeName('x'.repeat(80))?.length).toBe(64)
  })

  test('an asset route goes there and back, and a foreign address is nobody’s', () => {
    expect(assetStorePath(assetRoute('/s/ü b.png'))).toBe('/s/ü b.png')
    expect(assetStorePath('https://example.com/asset/s/a.png')).toBe('/s/a.png')
    expect(assetStorePath('https://example.com/other/a.png')).toBeNull()
    expect(assetType('a.PNG')).toBe('image/png')
    expect(assetType('a.bin', 'text/plain')).toBe('text/plain')
    expect(assetType('a.bin')).toBe('application/octet-stream')
    expect(mimeOfPath('a.jpeg?x=1')).toBe('image/jpeg')
    expect(mimeOfPath('a.xyz')).toBeNull()
  })
})

describe('note names', () => {
  test('a title becomes a file name without what a file system refuses', () => {
    expect(nameFromContent('# Hello: world?\nbody')).toBe('Hello world')
    expect(nameFromContent('\n\n- first words')).toBe('first words')
    expect(nameFromContent('# con')).toBe('_con')
    expect(nameFromContent('')).toBeNull()
  })

  test('endings, shown names and copies', () => {
    expect(endingOf('a.tar.gz')).toBe('.gz')
    expect(endingOf('a.pages')).toBe('.pages')
    expect(endingOf('no ending')).toBeNull()
    expect(shownName('n.canvas')).toBe('n')
    expect(shownName('.md')).toBe('.md')
    expect(copyName('a.md')).toBe('a copy.md')
    expect(copyName('.md')).toBe('copy.md')
    expect(isReserved('LPT1.txt')).toBe(true)
    expect(isReserved('report.md')).toBe(false)
  })

  test('a typed name is refused for one reason at a time', () => {
    const naming = { extension: '.md', taken: ['Taken.md', 'Deck.pages.pdf'] }
    expect(nameFault({ ...naming, typed: '  ' })).toBe('empty')
    expect(nameFault({ ...naming, typed: 'a/b' })).toBe('separator')
    expect(nameFault({ ...naming, typed: 'a?b' })).toBe('illegal')
    expect(nameFault({ ...naming, typed: 'a.' })).toBe('trailing')
    expect(nameFault({ ...naming, typed: 'nul' })).toBe('reserved')
    expect(nameFault({ ...naming, typed: 'AGENTS' })).toBe('agents')
    expect(nameFault({ ...naming, typed: 'AGENTS', current: 'agents.md' })).toBeNull()
    expect(nameFault({ ...naming, typed: 'taken' })).toBe('taken')
    expect(nameFault({ ...naming, typed: 'Deck', extension: '.pages' })).toBe('taken')
    expect(nameFault({ ...naming, typed: 'free' })).toBeNull()
    expect(nameToWrite('a.MD', '.md')).toBe('a.md')
    expect(nameToWrite('a', '')).toBe('a')
  })
})

describe('bytes', () => {
  test('base64 goes there and back, in chunks past 32k', async () => {
    const bytes = new Uint8Array(70_000).map((_, at) => at % 251)
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
    expect(parseDataUri('data:text/plain;base64,aGk=')).toEqual({
      mime: 'text/plain',
      bytes: new TextEncoder().encode('hi'),
    })
    expect(parseDataUri('data:,a%20b')?.mime).toBe('application/octet-stream')
    expect(parseDataUri('nope')).toBeNull()
    expect(await sha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  test('a log line keeps no token', () => {
    expect(tokensOut('Bearer abcdefghijkl and ghp_abcdefghijklmnop')).toBe(
      'Bearer <token> and <token>',
    )
  })
})

describe('waiting', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('backoff grows and is capped; only a server that may recover is retried', () => {
    expect(pollDelay(0, false)).toBe(20_000)
    expect(pollDelay(10, false)).toBe(120_000)
    expect(pollDelay(10, true)).toBe(600_000)
    expect(roomDelay(1, 0.5)).toBe(400)
    expect(roomDelay(20, 0.5)).toBe(20_000)
    expect([408, 429, 500, 503].every(passing)).toBe(true)
    expect([400, 401, 404].some(passing)).toBe(false)
  })

  test('afterQuiet runs once the calls stop, and at most after its cap', () => {
    const ran = vi.fn()
    const later = afterQuiet(ran, 100, 250)
    for (let at = 0; at < 8; at++) {
      later()
      vi.advanceTimersByTime(50)
    }
    expect(ran).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(100)
    expect(ran).toHaveBeenCalledTimes(2)
    later()
    later.cancel()
    vi.advanceTimersByTime(1_000)
    expect(ran).toHaveBeenCalledTimes(2)
  })

  test('waited settles after its time', async () => {
    const done = vi.fn()
    void waited(30).then(done)
    await vi.advanceTimersByTimeAsync(29)
    expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toHaveBeenCalled()
  })
})

describe('what this machine keeps', () => {
  const memory = new Map<string, string>()
  const fake = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  }

  beforeEach(() => {
    memory.clear()
    vi.stubGlobal('localStorage', fake)
  })
  afterEach(() => vi.unstubAllGlobals())

  test('json goes in and comes out, and what is not json is null', () => {
    expect(keepJson('k', { a: 1 })).toBe(true)
    expect(stored('k')).toEqual({ a: 1 })
    memory.set('k', '{')
    expect(stored('k')).toBeNull()
    expect(storedText('missing')).toBeNull()
  })

  test('a shared value is read again only when its text changed', () => {
    const read = vi.fn((value: unknown) => (typeof value === 'number' ? value : 0))
    const shared = new Shared('n', read)
    expect(shared.get()).toBe(0)
    expect(shared.get()).toBe(0)
    expect(read).toHaveBeenCalledTimes(1)
    memory.set('n', '7')
    expect(shared.get()).toBe(7)
    shared.set(9, '9')
    expect(memory.get('n')).toBe('9')
    expect(shared.get()).toBe(9)
    expect(read).toHaveBeenCalledTimes(2)
  })

  test('without storage nothing is kept and nothing throws', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(keepJson('k', 1)).toBe(false)
    expect(stored('k')).toBeNull()
  })

  test('records fold with and without a key, and fill in what is missing', () => {
    expect(withOrWithout({ a: 1 }, 'b', 2)).toEqual({ a: 1, b: 2 })
    expect(withOrWithout({ a: 1, b: 2 }, 'b', null)).toEqual({ a: 1 })
    expect(filledIn({ a: 1 }, { a: 5, b: 2 })).toEqual({ a: 1, b: 2 })
    expect(filledIn({ a: 1 }, { a: 5 })).toBeNull()
  })

  test('meeting a server value: ours is folded in and told, theirs is taken as is', () => {
    const folding = { fold: (theirs: number, mine: number) => theirs + mine, same: Object.is }
    expect(meet(undefined, 'u', 1, 2, folding)).toEqual({ value: 3, tell: true })
    expect(meet({ account: 'u' }, 'u', 1, 2, folding)).toEqual({ value: 2, tell: false })
    expect(meet({ account: 'u' }, 'u', 2, 2, folding)).toBeNull()
    expect(meet({ account: 'other' }, 'u', 1, 2, folding)).toEqual({ value: 3, tell: true })
  })
})

describe('a request in time', () => {
  test('gives up in time with the words the sheets show, and an abort from the caller stays its own', async () => {
    const never: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const why: unknown = init.signal?.reason
          reject(why instanceof Error ? why : new Error('aborted'))
        })
      })
    const was = globalThis.fetch
    globalThis.fetch = never
    try {
      await expect(fetchInTime('https://example.org', {}, 5)).rejects.toThrow(LATE)
      const own = new AbortController()
      const asked = fetchInTime('https://example.org', { signal: own.signal }, 1000)
      own.abort(new Error('went away'))
      await expect(asked).rejects.toThrow('went away')
    } finally {
      globalThis.fetch = was
    }
  })
})
