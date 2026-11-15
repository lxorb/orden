import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Archive, ArchivedSpaces, isTile, sameBookmark } from '../src/api'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
const ROOT = join(HERE, '../../../../..')
const ENDINGS = ['', '.ts', '.svelte.ts', '.svelte', '/index.ts']

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

function storage(): Storage {
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

vi.stubGlobal('localStorage', storage())

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('the module stands on its own', () => {
  test('nothing under src reaches past a module api or a file still listed as pending', () => {
    const json = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8')) as {
      pending?: string[]
    }
    const pending = json.pending ?? []
    const reaching = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/(?:from |import\()'(\.[^']*)'/g)].flatMap(
        (found) => {
          const target = resolve(dirname(file), found[1] ?? '')
          if (target.startsWith(SRC)) return []
          if (/\/[a-z-]+\/src\/api$/.test(target)) return []
          const path = ENDINGS.map((one) => target + one).find((one) => existsSync(one))
          const named = path === undefined ? target : relative(ROOT, path)
          return pending.includes(named) ? [] : [`${relative(SRC, file)}: ${found[1]}`]
        },
      ),
    )
    expect(reaching).toEqual([])
  })
})

describe('what a space keeps beside its files', () => {
  test('an archived folder hides what is under it, and its mark moves with it', async () => {
    const archive = new Archive(() => '/s')
    await archive.change('/s', ['Work'], [])
    expect(archive.has('/s/Work/Plan.md')).toBe(true)
    expect(archive.has('/s/Workshop.md')).toBe(false)
    archive.moved('/s/Work', '/s/Old/Work')
    await vi.waitFor(() => expect([...archive.keysOf('/s')]).toEqual(['Old/Work']))
    archive.forget('/s')
    expect(archive.of('/s')).toEqual({})
  })

  test('a space put away is remembered until it comes back', () => {
    const spaces = new ArchivedSpaces()
    expect(spaces.set('/s', true)).toBe(true)
    expect(spaces.set('/s', true)).toBe(false)
    expect(spaces.has('/s')).toBe(true)
    spaces.set('/s', false)
    expect(spaces.has('/s')).toBe(false)
  })

  test('a bookmark is the same by kind, place and words, and a tile is a note in no group', () => {
    const plan = { kind: 'note', path: 'Plan.md', text: 'Plan' } as const
    expect(sameBookmark(plan, { ...plan })).toBe(true)
    expect(sameBookmark(plan, { ...plan, kind: 'folder' })).toBe(false)
    expect(isTile(plan)).toBe(true)
    expect(isTile({ ...plan, parent: 'g1' })).toBe(false)
  })
})
