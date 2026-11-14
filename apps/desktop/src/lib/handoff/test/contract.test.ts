import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { HANDOFF_PATH, isEmpty, isHandoff, LEGACY_WEB, WEB } from '../src/api'

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

  test('reaches no app module but the platform', () => {
    const reached = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/from '\.\.\/\.\.\/([a-z-]+)\/src\/api'/g)].map(
        (found) => found[1],
      ),
    )
    expect([...new Set(reached)].sort()).toEqual(['platform'])
  })
})

describe('the notes handed over from the old address', () => {
  test('a handoff is what either name of the app sent, and nothing else', () => {
    expect(isHandoff({ kind: 'orden-handoff', databases: [], local: [] })).toBe(true)
    expect(isHandoff({ kind: 'nib-handoff', databases: [], local: [] })).toBe(true)
    expect(isHandoff({ kind: 'other', databases: [], local: [] })).toBe(false)
    expect(isHandoff(null)).toBe(false)
  })

  test('a handoff with no keys and no rows holds nothing', () => {
    expect(isEmpty({ kind: 'orden-handoff', databases: [], local: [] })).toBe(true)
    expect(isEmpty({ kind: 'orden-handoff', databases: [], local: [['a', 'b']] })).toBe(false)
  })

  test('the old address asks the new one over a path of its own', () => {
    expect(WEB).toMatch(/^https:\/\//)
    expect(LEGACY_WEB).toMatch(/^https:\/\//)
    expect(WEB).not.toBe(LEGACY_WEB)
    expect(HANDOFF_PATH.startsWith('/')).toBe(true)
  })
})
