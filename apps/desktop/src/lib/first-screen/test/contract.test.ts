import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { firstScreen, keepFirstScreens, sameNote } from '../src/api'
import { keptOf, wordsHash } from '../src/first-screen.svelte'

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

  test('the api loads with nothing kept yet and the keeper asleep', () => {
    expect(typeof keepFirstScreens).toBe('function')
    expect(typeof firstScreen).toBe('object')
  })
})

describe("a note's first screen", () => {
  test('belongs to the same note whatever the path is spelled like, and no path only to none', () => {
    expect(sameNote('/a/Plan.md', '/a/Plan.md')).toBe(true)
    expect(sameNote(null, null)).toBe(true)
    expect(sameNote(null, '/a/Plan.md')).toBe(false)
  })

  test('is kept for the words it was drawn from, whatever their line endings', () => {
    expect(wordsHash('one\r\ntwo\r\n')).toBe(wordsHash('one\ntwo\n'))
    expect(wordsHash('one')).not.toBe(wordsHash('two'))
  })

  test('is read back only whole', () => {
    expect(keptOf(null)).toBeNull()
    expect(keptOf({ build: 'x', path: null, words: 'w' })).toBeNull()
  })
})
