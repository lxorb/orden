import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { registerTabKind, tabKindParts } from '@orden/contracts'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})

const { initialOf, placed, PREVIEW_DELAY, previewDelay, tabMenus, twins, unloadTabs, wheelAlong } =
  await import('../src/api')

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

  test('no file under src names a feature: web pages go through the port, other kinds through the registry', () => {
    const named = sources(SRC).filter((file) =>
      /\/(?:web-tab|terminal|apps|online-terms)\/src\//.test(readFileSync(file, 'utf8')),
    )
    expect(named).toEqual([])
  })
})

describe('the strip', () => {
  test('lays tabs side by side in the widths it is given', () => {
    expect(placed([100, 50])).toEqual([
      { x: 0, width: 100 },
      { x: 100, width: 50 },
    ])
  })

  test('marks the tabs that look alike, and reads a wheel turned in lines', () => {
    const tabs = [
      { id: 'a', look: 'web:a.example' },
      { id: 'b', look: 'web:a.example' },
      { id: 'c', look: null },
    ]
    expect(twins(tabs)).toEqual(new Set(['a', 'b']))
    expect(initialOf('plans')).toBe('P')
    expect(wheelAlong({ deltaX: 0, deltaY: 3, deltaMode: 1, ctrlKey: false }, 600)).toBe(120)
  })

  test('keeps its choices: unloading from the menu is off, the preview waits half a second', () => {
    expect(unloadTabs.on).toBe(false)
    unloadTabs.set(true)
    expect(held.get('orden:unload-tabs')).toBe('yes')
    expect(previewDelay.ms).toBe(PREVIEW_DELAY.initial)
    previewDelay.set(PREVIEW_DELAY.most + 1)
    expect(previewDelay.ms).toBe(PREVIEW_DELAY.most)
  })
})

describe('the tab menu', () => {
  test('loads the parts a kind registered before it is drawn', async () => {
    const parts = { menu: () => [{ label: 'Open another', run: () => undefined }, null] }
    const unregister = registerTabKind('terminal', () => Promise.resolve(parts))
    expect(tabKindParts('terminal')).not.toBe(parts)
    const menus = await tabMenus('terminal')
    expect(typeof menus.tabMenu).toBe('function')
    expect(tabKindParts('terminal')).toBe(parts)
    unregister()
  })
})
