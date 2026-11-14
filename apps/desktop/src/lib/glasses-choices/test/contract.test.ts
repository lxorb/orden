import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { bare, bestOf, numberIn } from '../src/commands'

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
})

describe('the words the glasses hear', () => {
  test('are compared bare: lower case, no marks, single spaces', () => {
    expect(bare('  Next,  PAGE! ')).toBe('next page')
  })

  test('a number is read from digits or from spoken words', () => {
    expect(numberIn('1 2')).toBe(12)
    expect(numberIn('twenty three')).toBe(23)
    expect(numberIn('two hundred')).toBe(200)
    expect(numberIn('some page')).toBeNull()
  })

  test('a heard name picks the closest one, or none when nothing is near', () => {
    expect(bestOf('lecture', ['Lecture notes', 'Groceries'])).toBe('Lecture notes')
    expect(bestOf('banana', ['Lecture notes', 'Groceries'])).toBeNull()
  })
})
