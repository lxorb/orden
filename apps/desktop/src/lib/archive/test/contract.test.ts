import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { ARCHIVE_MARK } from '../src/api'

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

  test('reaches no app module but the platform, the undo record and the tree', () => {
    const reached = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/from '\.\.\/\.\.\/([a-z-]+)\/src\/api'/g)].map(
        (found) => found[1],
      ),
    )
    expect([...new Set(reached)].sort()).toEqual(['file-undo', 'platform', 'tree'])
  })
})

describe('the archive of a space', () => {
  test('the api holds only its mark statically and leaves the list and the archiving behind doors', () => {
    const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
    const statics = [...api.matchAll(/^export \{[^}]*\} from '\.\/([A-Za-z.-]+)'/gm)].map(
      (found) => found[1],
    )
    expect(statics).toEqual(['archive-marks'])
    expect(api).toMatch(/import\('\.\/Archive\.svelte'\)/)
    expect(api).toMatch(/import\('\.\/ArchivedStrip\.svelte'\)/)
    expect(api).toMatch(/import\('\.\/archiving'\)/)
  })

  test('its mark is a path drawn in the 13 by 13 box the rows use', () => {
    expect(ARCHIVE_MARK.startsWith('M')).toBe(true)
    const numbers = [...ARCHIVE_MARK.matchAll(/-?\d*\.?\d+/g)].map((found) => Number(found[0]))
    expect(numbers.every((one) => one >= -13 && one <= 13)).toBe(true)
  })
})
