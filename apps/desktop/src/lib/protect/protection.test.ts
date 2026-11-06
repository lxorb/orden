import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Protection, protectedMap, SPACE, STORAGE_KEY } from './protection.svelte'

function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const ROOT = '/space'
const OTHER = '/other'
const at = (relative: string) => `${ROOT}/${relative}`
const keys = (protection: Protection, root = ROOT) =>
  protection.covering(`${root}/Inside/deep.md`).map((one) => one.key)

let protection: Protection

beforeEach(() => {
  localStorage.clear()
  protection = new Protection()
})

describe('protecting', () => {
  test('a note locks that note and nothing beside it', () => {
    protection.set(ROOT, at('Plans.md'), 'password')
    expect(protection.covering(at('Plans.md'))).toEqual([
      { root: ROOT, key: 'Plans.md', way: 'password' },
    ])
    expect(protection.covering(at('Plans 2.md'))).toEqual([])
  })

  test('a folder locks everything under it', () => {
    protection.set(ROOT, at('Inside'), 'device')
    expect(keys(protection)).toEqual(['Inside'])
    expect(protection.covering(at('Insider.md'))).toEqual([])
  })

  test('a space locks every path in it, and none outside it', () => {
    protection.set(ROOT, ROOT, 'password')
    expect(keys(protection)).toEqual([SPACE])
    expect(protection.covering(at('a.md'))).toHaveLength(1)
    expect(protection.covering('/elsewhere/a.md')).toEqual([])
  })

  test('is kept as the space speaks of it, and read back after a restart', () => {
    protection.set(ROOT, at('Inside'), 'password')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      [ROOT]: { ways: { Inside: 'password' }, account: null, sent: false },
    })
    expect(keys(new Protection())).toEqual(['Inside'])
  })

  test('taken away, locks nothing', () => {
    protection.set(ROOT, at('Inside'), 'password')
    protection.set(ROOT, at('Inside'), null)
    expect(protection.any).toBe(false)
  })

  test('reads only paths inside a space and ways it knows', () => {
    expect(
      protectedMap({
        ok: 'password',
        '': 'device',
        '../out': 'password',
        '/abs': 'device',
        x: 'pin',
      }),
    ).toEqual({ ok: 'password', '': 'device' })
  })
})

describe('a protected path that moves', () => {
  test('stays protected under its new name', () => {
    protection.set(ROOT, at('Inside'), 'password')
    protection.moved(at('Inside'), at('Renamed'), ROOT)
    expect(protection.covering(at('Renamed/deep.md'))).toHaveLength(1)
    expect(protection.covering(at('Inside/deep.md'))).toEqual([])
  })

  test('into another space, stays protected there', () => {
    protection.set(ROOT, ROOT, 'password')
    protection.set(ROOT, at('Inside'), 'device')
    protection.moved(at('Inside'), `${OTHER}/Inside`, ROOT, OTHER)
    expect(protection.covering(`${OTHER}/Inside/deep.md`)).toEqual([
      { root: OTHER, key: 'Inside', way: 'device' },
    ])
    expect(protection.own(ROOT, ROOT)?.way).toBe('password')
  })

  test('that is deleted is forgotten, the space kept', () => {
    protection.set(ROOT, ROOT, 'password')
    protection.set(ROOT, at('Inside/deep.md'), 'password')
    protection.gone(at('Inside'), ROOT)
    expect(protection.ways(ROOT)).toEqual({ [SPACE]: 'password' })
  })

  test('with its space renamed follows the space', () => {
    protection.set(ROOT, at('Inside'), 'password')
    protection.spaceMoved(ROOT, '/renamed')
    expect(keys(protection, '/renamed')).toEqual(['Inside'])
  })
})

describe('what the account holds of it', () => {
  test('is folded with this machine’s the first time, and taken after that', () => {
    protection.set(ROOT, at('Mine'), 'password')
    expect(protection.adopt(ROOT, { Theirs: 'device' }, 'u1')).toBe(true)
    expect(protection.ways(ROOT)).toEqual({ Theirs: 'device', Mine: 'password' })

    protection.said(ROOT, true)
    expect(protection.adopt(ROOT, { Theirs: 'device' }, 'u1')).toBe(false)
    expect(protection.ways(ROOT)).toEqual({ Theirs: 'device' })
  })

  test('does not take back what this machine changed and has not sent yet', () => {
    protection.adopt(ROOT, {}, 'u1')
    protection.set(ROOT, at('Mine'), 'password')
    expect(protection.adopt(ROOT, {}, 'u1')).toBe(true)
    expect(protection.ways(ROOT)).toEqual({ Mine: 'password' })
  })

  test('keeps the newer of two passwords', () => {
    const older = { n: 16, r: 1, p: 1, salt: 'c2FsdA==', hash: 'b2xkZXI=', at: 1 }
    const newer = { ...older, hash: 'bmV3ZXI=', at: Date.now() + 1000 }
    protection.setPassword(older)
    expect(protection.adoptPassword(newer)).toBe(false)
    expect(protection.password?.hash).toBe('bmV3ZXI=')
    expect(protection.adoptPassword({ ...older, at: 2 })).toBe(true)
    expect(protection.password?.hash).toBe('bmV3ZXI=')
  })
})
