import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})

const api = await import('../src/api')

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

  test('no file under src names a feature: pages, PDFs and chat links come through contracts', () => {
    const named = sources(SRC).filter((file) =>
      /\/(?:agents|chats-client|pdf|web-tab)\/src\//.test(readFileSync(file, 'utf8')),
    )
    expect(named).toEqual([])
  })

  test('the api leaves the start and the acts behind doors', () => {
    const text = readFileSync(join(SRC, 'api.ts'), 'utf8')
    expect(text).not.toMatch(/from '\.\/(?:start|acts|verbs|moving)'/)
    for (const door of [api.automationStart, api.automationActs, api.automationMoving]) {
      expect(typeof door).toBe('function')
    }
  })
})

describe('who asks', () => {
  test('nobody named is the reader, and an agent keeps only what it was granted', () => {
    expect(api.callerOf(undefined)).toBe(api.READER)
    const caller = api.callerOf({ id: 'a1', name: 'Scout', scopes: ['tree', 7] }, 'thread-1')
    expect(caller.agent?.scopes).toEqual(['tree'])
    expect(api.threadSpaceOf(caller)).toBeNull()
  })

  test('a refusal carries its code and says why twice', () => {
    expect(api.refusal('no_such_command', 'gone')).toEqual({
      ok: false,
      status: 'error',
      code: 'no_such_command',
      message: 'gone',
      error: 'gone',
    })
  })

  test('the words of a call read as text or as yes', () => {
    expect(api.said({ path: ' Plan.md ' }, 'path')).toBe('Plan.md')
    expect(api.yes({ open: 'true' }, 'open')).toBe(true)
  })
})

describe('moving a note', () => {
  test('a markdown note keeps its extension where it goes', async () => {
    const { movedPath } = await api.automationMoving()
    expect(movedPath('Plan.md', 'Work/Later')).toBe('Work/Later.md')
  })
})
