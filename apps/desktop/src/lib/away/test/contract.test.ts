import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { keptAway, NOT_HERE } from '../src/api'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

describe('the module stands on its own', () => {
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
