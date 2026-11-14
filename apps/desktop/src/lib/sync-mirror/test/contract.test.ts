import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  conflictRule,
  DEFAULT_RULE,
  newMirror,
  readMirror,
  returning,
  savedRecord,
  within,
} from '../src/api'

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

  test('the api names what the shell reads at startup and leaves the passes behind doors', () => {
    const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
    const statics = [...api.matchAll(/^export \{[^}]*\} from '\.\/([a-z.-]+)'/gm)].map(
      (found) => found[1],
    )
    expect(statics).not.toContain('pass')
    expect(statics).not.toContain('meeting')
    expect(statics).not.toContain('holding')
    expect(statics).not.toContain('write-down')
    expect(api).toMatch(/import\('\.\/pass'\)/)
  })
})

describe('what the sync remembers', () => {
  test('a conflict rule is one of three, and both copies when nothing was said', () => {
    expect(DEFAULT_RULE).toBe('both')
    expect(conflictRule('ask')).toBe('ask')
    expect(conflictRule('newest')).toBe('newest')
    expect(conflictRule('loudest')).toBeNull()
    expect(conflictRule(3)).toBeNull()
  })

  test('a path inside a space is read relative to its root, whichever way its slashes lean', () => {
    expect(within('/Notes/', '/Notes/a/b.md')).toBe('a/b.md')
    expect(within('C:\\Notes', 'C:\\Notes\\a.md')).toBe('a.md')
    expect(within('/Notes', '/Notebook/a.md')).toBeNull()
  })

  test('a mirror written down is read back, and nonsense is no mirror', () => {
    const mirror = { ...newMirror('s1', '/Notes'), cursor: 4 }
    const saved = savedRecord({ account: 'u1', mirrors: { '/Notes': mirror } })
    expect(saved?.whose).toBe('u1')
    expect(saved?.seen).toBe(true)
    expect(saved?.mirrors['/Notes']?.cursor).toBe(4)
    expect(readMirror('/Notes', { cursor: 2 })).toBeNull()
    expect(savedRecord('nothing')).toBeNull()
  })

  test('a device that held another account asks before its notes meet the new one', async () => {
    const { apartName, asksOnReturn, baseFor } = await returning()
    expect(baseFor(null, 'u1')).toBe('none')
    expect(baseFor({ whose: 'u2', mirrors: { '/Notes': {} } }, 'u1')).toBe('other')
    expect(asksOnReturn('other', true)).toBe(true)
    expect(asksOnReturn('mine', true)).toBe(false)
    expect(apartName('Plans', new Set(['Plans 2']))).toBe('Plans 3')
  })
})
