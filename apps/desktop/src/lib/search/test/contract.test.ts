import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { changesFor, searchSpace, searchWarmth, selectedWords } from '../src/api'

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

  test('loads only the selection and the space search with it, and the rest through doors', () => {
    const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
    const loaded = [...api.matchAll(/^export \{[^}]*\} from '([^']+)'/gm)].map((one) => one[1])
    expect(loaded).toEqual(['./seed', './space'])
    for (const one of [searchSpace, searchWarmth, changesFor]) expect(typeof one).toBe('function')
  })
})

const selecting = (text: string, from: number, to: number) =>
  ({
    selection: { main: { from, to, empty: from === to } },
    sliceDoc: (start: number, end: number) => text.slice(start, end),
  }) as never

describe('the words a search starts from', () => {
  test('are the selected words, trimmed', () => {
    expect(selectedWords(selecting('one  two three', 3, 8))).toBe('two')
  })

  test('are none for an empty selection, one over lines or one too long to be a search', () => {
    expect(selectedWords(selecting('one two', 2, 2))).toBeNull()
    expect(selectedWords(selecting('one\ntwo', 0, 7))).toBeNull()
    expect(selectedWords(selecting('a'.repeat(300), 0, 300))).toBeNull()
  })
})

describe('a replacement', () => {
  const notes: Record<string, string> = {
    '/space/One.md': 'alpha here\nbeta\nalpha again\n',
    '/space/Link.url': 'alpha\n',
  }
  const hit = (path: string, line: number) => ({ path, name: path, line, text: '', ranges: [] })
  const alpha = { kind: 'text', text: 'alpha', fold: true } as const

  test('changes the lines that were hit in notes, and says how to put each back', async () => {
    const made = await changesFor(
      alpha,
      [hit('/space/One.md', 0), hit('/space/Link.url', 0)],
      'gamma',
      '/space',
      (path) => Promise.resolve(notes[path] ?? null),
    )
    expect(made.map((one) => [one.path, one.after])).toEqual([
      ['/space/One.md', 'gamma here\nbeta\nalpha again\n'],
    ])
    expect(made[0]?.back).toEqual([{ from: 0, to: 5, insert: 'alpha' }])
  })

  test('changes nothing in a note that is gone', async () => {
    const made = await changesFor(alpha, [hit('/space/One.md', 0)], 'gamma', '/space', () =>
      Promise.resolve(null),
    )
    expect(made).toEqual([])
  })
})

describe("the search's hold on a space", () => {
  test('says nothing before a space is warmed', async () => {
    expect((await searchWarmth()).said).toBeUndefined()
  })
})
