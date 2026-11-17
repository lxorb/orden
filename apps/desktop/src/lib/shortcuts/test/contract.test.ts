import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { registerCommand } from '@orden/contracts'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})

const { BY_ID, CATEGORIES, runEntry, SHORTCUTS, shortcuts } = await import('../src/api')

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

  test('no file under src names a feature or the tab strip: their shortcuts run as registered commands', () => {
    const named = sources(SRC).filter((file) =>
      /\/(?:web-tab|ai-chat|scratchpad|time|agents|explorer|pass-sync|tab-strip)\/src\//.test(
        readFileSync(file, 'utf8'),
      ),
    )
    expect(named).toEqual([])
  })
})

describe('the shortcuts', () => {
  test('each has its own id and a category the list names', () => {
    const ids = SHORTCUTS.map((one) => one.id)
    expect(new Set(ids).size).toBe(ids.length)
    const named = new Set(CATEGORIES.map((one) => one.id))
    expect(SHORTCUTS.filter((one) => !named.has(one.category)).map((one) => one.id)).toEqual([])
    expect(BY_ID.get('app.close')?.key).toBe('Mod-w')
  })

  test('run a feature through the command it registered', async () => {
    const ran: string[] = []
    const unregister = registerCommand('app.scratchpad', () =>
      Promise.resolve(() => void ran.push('scratchpad')),
    )
    const context = { palette: () => undefined, fullscreen: () => undefined }
    expect(runEntry('app.scratchpad', context)).toBe(true)
    await vi.waitFor(() => expect(ran).toEqual(['scratchpad']))
    unregister()
  })

  test('say the key a shortcut is bound to', () => {
    expect(shortcuts.keyFor('app.close')).toBe('Mod-w')
  })
})
