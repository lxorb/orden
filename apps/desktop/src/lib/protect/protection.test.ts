import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Protection, protectedMap, SPACE, STORAGE_KEY } from './protection.svelte'
import { unlocks } from './unlocked.svelte'

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

  test('copied, leaves a copy that is as protected', () => {
    protection.set(ROOT, at('Plans.md'), 'device')
    protection.copied(at('Plans.md'), at('Plans copy.md'), ROOT, ROOT)
    expect(protection.covering(at('Plans copy.md'))).toEqual([
      { root: ROOT, key: 'Plans copy.md', way: 'device' },
    ])
  })

  test('copied with what is protected inside it, keeps those protected in the copy', () => {
    protection.set(ROOT, at('Trip/Diary.md'), 'password')
    protection.copied(at('Trip'), `${OTHER}/Trip`, ROOT, OTHER)
    expect(protection.covering(`${OTHER}/Trip/Diary.md`)).toEqual([
      { root: OTHER, key: 'Trip/Diary.md', way: 'password' },
    ])
    expect(protection.covering(`${OTHER}/Trip/Packing.md`)).toEqual([])
  })

  test('copied out from under a protected folder or space, stays protected', () => {
    protection.set(ROOT, at('Diary'), 'password')
    protection.set(OTHER, OTHER, 'device')
    protection.copied(at('Diary/Monday.md'), at('Monday.md'), ROOT, ROOT)
    expect(protection.covering(at('Monday.md'))).toEqual([
      { root: ROOT, key: 'Monday.md', way: 'password' },
    ])
    protection.copied(`${OTHER}/Plans.md`, at('Plans.md'), OTHER, ROOT)
    expect(protection.covering(at('Plans.md'))).toEqual([
      { root: ROOT, key: 'Plans.md', way: 'device' },
    ])
  })

  test('copied beside itself under the same lock, adds no lock of its own', () => {
    protection.set(ROOT, at('Diary'), 'password')
    protection.copied(at('Diary/Monday.md'), at('Diary/Monday copy.md'), ROOT, ROOT)
    expect(protection.ways(ROOT)).toEqual({ Diary: 'password' })
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

describe('what is locked', () => {
  test('follows each lock, unlock and lock again, as many notes are asked', () => {
    const notes = Array.from({ length: 2000 }, (_, at) => `${ROOT}/Inside/note ${at}.md`)
    const shut = () => notes.filter((one) => protection.locked(one)).length
    expect(shut()).toBe(0)
    protection.set(ROOT, at('Inside'), 'password')
    expect(shut()).toBe(2000)
    expect(protection.locked(at('Outside.md'))).toBe(false)
    expect(protection.locked(`${OTHER}/Inside/note 1.md`)).toBe(false)
    const locks = protection.covering(at('Inside/note 1.md'))
    unlocks.unlock(locks)
    expect(shut()).toBe(0)
    protection.set(ROOT, at('Inside/note 7.md'), 'device')
    expect(notes.filter((one) => protection.locked(one))).toEqual([at('Inside/note 7.md')])
    unlocks.close(locks)
    expect(shut()).toBe(2000)
    protection.set(ROOT, at('Inside'), null)
    protection.set(ROOT, at('Inside/note 7.md'), null)
    expect(shut()).toBe(0)
  })
})

describe('a copy an outside sync tool left of a protected note', () => {
  const copies = [
    'Diary (conflicted copy 2026-11-08 101010).md',
    "Diary (Emil's conflicted copy 2026-11-08).md",
    'Diary.sync-conflict-20261108-101010-ABCDEFG.md',
    'Diary_conflict-20261108-101010.md',
    'Diary-DESKTOP-AB12CD3.md',
  ]

  test('is locked with the note, and opens with it', () => {
    protection.set(ROOT, at('Diary.md'), 'password')
    for (const name of copies) {
      expect(protection.locked(at(name))).toBe(true)
      expect(protection.covering(at(name))).toEqual([
        { root: ROOT, key: 'Diary.md', way: 'password' },
      ])
    }
    expect(protection.locked(at('Diary 2.md'))).toBe(false)
    expect(protection.locked(at('Plans (conflicted copy 2026-11-08 101010).md'))).toBe(false)
    unlocks.unlock(protection.covering(at(copies[0] ?? '')))
    expect(protection.locked(at('Diary.md'))).toBe(false)
    unlocks.lockAll()
  })

  test('of a protected folder is locked, with everything in it', () => {
    protection.set(ROOT, at('Inside'), 'device')
    expect(protection.locked(at('Inside (conflicted copy 2026-11-08 101010)/a.md'))).toBe(true)
    expect(protection.locked(at('Inside/a.sync-conflict-20261108-101010-ABCDEFG.md'))).toBe(true)
    expect(protection.covering(at('Inside/b (conflicted copy 2026-11-08 101010).md'))).toEqual([
      { root: ROOT, key: 'Inside', way: 'device' },
    ])
  })

  test('wears the lock mark its note or folder wears', () => {
    protection.set(ROOT, at('Diary.md'), 'password')
    protection.set(ROOT, at('Inside'), 'device')
    for (const name of copies) expect(protection.marked(ROOT, at(name))).toBe(true)
    expect(protection.marked(ROOT, at('Inside (conflicted copy 2026-11-08 101010)'))).toBe(true)
    expect(protection.marked(ROOT, at('Inside (conflicted copy 2026-11-08 101010)/a.md'))).toBe(
      false,
    )
    expect(protection.marked(ROOT, at('Plans (conflicted copy 2026-11-08 101010).md'))).toBe(false)
    expect(protection.marked(ROOT, at('Diary 2.md'))).toBe(false)
  })

  test('is told once, when it lies under the same lock as its note', () => {
    protection.set(ROOT, at('Inside'), 'device')
    protection.set(ROOT, at('Inside/Diary.md'), 'password')
    expect(protection.covering(at('Inside/Diary (conflicted copy 2026-11-08 101010).md'))).toEqual([
      { root: ROOT, key: 'Inside', way: 'device' },
      { root: ROOT, key: 'Inside/Diary.md', way: 'password' },
    ])
  })
})
