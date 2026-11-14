import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  buildGraph,
  neighbourhood,
  neighbours,
  type NoteGraph,
  signature,
  without,
  worthAGraph,
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

type Notes = Parameters<typeof buildGraph>[0]

function note(path: string, ...targets: string[]): Notes[number] {
  return {
    path,
    name: path.replace(/\.md$/, ''),
    tags: [],
    links: targets.map((target) => ({ kind: 'wiki', target })),
  } as unknown as Notes[number]
}

const byName = (_from: string, link: { target: string }) => `${link.target}.md`

function chain(count: number): NoteGraph {
  const nodes = Array.from({ length: count }, (_, one) => ({
    id: `n${one}.md`,
    name: `n${one}`,
    path: `n${one}.md`,
    degree: one === 0 || one === count - 1 ? 1 : 2,
    tags: [],
  }))
  const edges = Array.from({ length: count - 1 }, (_, one) => ({ a: one, b: one + 1, both: false }))
  return { nodes, edges }
}

describe('a note graph', () => {
  test('joins notes by their links, once a pair, and counts each side', () => {
    const graph = buildGraph(
      [note('a.md', 'b'), note('b.md', 'a'), note('c.md', 'a', 'a')],
      (from, link) => (from === 'c.md' && link.target === 'a' ? 'a.md' : byName(from, link)),
    )
    expect(graph.nodes.map((one) => [one.id, one.degree])).toEqual([
      ['a.md', 2],
      ['b.md', 1],
      ['c.md', 1],
    ])
    expect(graph.edges).toEqual([
      { a: 0, b: 1, both: true },
      { a: 2, b: 0, both: false },
    ])
  })

  test('draws a link to nowhere as a missing note and leaves hidden folders out', () => {
    const graph = buildGraph([note('a.md', 'gone'), note('.hidden/b.md', 'a')], () => null)
    expect(graph.nodes.map((one) => [one.name, one.path])).toEqual([
      ['a', 'a.md'],
      ['gone', null],
    ])
  })

  test('leaves out the notes under an excluded folder and renumbers the rest', () => {
    const graph = buildGraph([note('a.md', 'x/b'), note('x/b.md', 'c'), note('c.md', 'a')], byName)
    const left = without(graph, ['x'])
    expect(left.nodes.map((one) => one.id)).toEqual(['a.md', 'c.md'])
    expect(left.edges).toEqual([{ a: 1, b: 0, both: false }])
    expect(without(graph, [])).toBe(graph)
  })

  test('is worth drawing once enough notes are joined', () => {
    expect(worthAGraph(chain(4))).toBe(false)
    expect(worthAGraph(chain(5))).toBe(true)
  })

  test('is walked to its neighbours and to a neighbourhood of a given depth', () => {
    const graph = chain(6)
    expect([...neighbours(graph, 2)].sort()).toEqual([1, 3])
    expect(neighbourhood(graph, 'n0.md', 2).nodes.map((one) => one.id)).toEqual([
      'n0.md',
      'n1.md',
      'n2.md',
    ])
    expect(signature(graph)).toBe(signature(chain(6)))
    expect(signature(graph)).not.toBe(signature(chain(5)))
  })
})
