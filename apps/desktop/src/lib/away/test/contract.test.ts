import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { keptAway, NOT_HERE } from '../src/api'

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
    expect([...new Set(reached)]).toEqual(['platform'])
  })
})

describe('the notes kept away from this device', () => {
  test('a note let go of is away until it is brought back, once', async () => {
    const fetched: string[] = []
    keptAway.keep([], (path) => {
      fetched.push(path)
      return Promise.resolve(true)
    })
    keptAway.went('/space/a.md')
    expect(keptAway.at('/space/a.md')?.path).toBe('/space/a.md')
    expect(await keptAway.bringBack('/space/a.md')).toBe(true)
    expect(keptAway.at('/space/a.md')).toBeNull()
    expect(fetched).toEqual(['/space/a.md'])
    keptAway.clear()
  })

  test('nothing is away once the list is cleared, and saying so has words', () => {
    keptAway.went('/space/b.md')
    keptAway.clear()
    expect(keptAway.all()).toEqual([])
    expect(NOT_HERE.length).toBeGreaterThan(0)
  })
})
