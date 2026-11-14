import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { DEEPEST, loadGraph, SHALLOWEST, SpaceGraphSettings } from '../src/api'

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

function pendingOf(): string[] {
  const json = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8')) as { pending?: string[] }
  return json.pending ?? []
}

describe('the module stands on its own', () => {
  test('nothing under src reaches past a module api or a file still listed as pending', () => {
    const pending = pendingOf()
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

  test('the api leaves the drawn graph behind its door', () => {
    const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
    const statics = [...api.matchAll(/^export \{[^}]*\} from '\.\/([A-Za-z.-]+)'/gm)].map(
      (found) => found[1],
    )
    expect(statics).toEqual(['settings.svelte'])
    expect(api).toMatch(/import\('\.\/Graph\.svelte'\)/)
    expect(typeof loadGraph).toBe('function')
  })
})

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

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("a space's graph settings", () => {
  test('with no space open there is nothing to change', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const settings = new SpaceGraphSettings(() => null)
    const before = settings.here
    settings.set({ depth: DEEPEST })
    expect(settings.here).toEqual(before)
  })

  test('a depth is held between the shallowest and the deepest', () => {
    vi.useFakeTimers()
    vi.stubGlobal('localStorage', memoryStorage())
    const settings = new SpaceGraphSettings(() => '/space')
    settings.set({ depth: DEEPEST + 10 })
    expect(settings.here.depth).toBe(DEEPEST)
    settings.set({ depth: 0 })
    expect(settings.here.depth).toBe(SHALLOWEST)
  })
})
