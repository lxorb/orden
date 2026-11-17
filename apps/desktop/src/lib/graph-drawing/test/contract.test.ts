import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { Layout, radiusOf } from '../src/api'

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

  test('no file under src waits on a door, so the site script bundles it as one IIFE', () => {
    const doors = sources(SRC).filter((file) => /\bimport\(/.test(readFileSync(file, 'utf8')))
    expect(doors.map((file) => relative(SRC, file))).toEqual([])
  })

  test('reaches no app module but the ones it declares', () => {
    const json = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8')) as {
      dependsOn: string[]
    }
    const reached = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/from '\.\.\/\.\.\/([a-z-]+)\/src\/api'/g)].map(
        (found) => found[1] ?? '',
      ),
    )
    expect(reached.filter((name) => !json.dependsOn.includes(name))).toEqual([])
  })
})

type Graph = ConstructorParameters<typeof Layout>[0]

function star(spokes: number): Graph {
  const nodes = Array.from({ length: spokes + 1 }, (_, one) => ({
    id: `n${one}`,
    name: `n${one}`,
    path: `n${one}.md`,
    degree: one === 0 ? spokes : 1,
    tags: [],
  }))
  const edges = Array.from({ length: spokes }, (_, one) => ({ a: 0, b: one + 1, both: false }))
  return { nodes, edges }
}

describe('drawing a graph', () => {
  test('a layout comes to rest with every node somewhere on the plane', () => {
    const layout = new Layout(star(8), { seed: 3 })
    while (!layout.settle(100));
    expect(layout.settled).toBe(true)
    expect([...layout.x, ...layout.y].every(Number.isFinite)).toBe(true)
  })

  test('the same seed lays the same graph out the same way', () => {
    const one = new Layout(star(5), { seed: 7 })
    const other = new Layout(star(5), { seed: 7 })
    one.tick(20)
    other.tick(20)
    expect([...one.x]).toEqual([...other.x])
  })

  test('a node with more links is drawn larger, up to a limit', () => {
    expect(radiusOf(9)).toBeGreaterThan(radiusOf(1))
    expect(radiusOf(10_000)).toBe(radiusOf(1_000_000))
  })
})
