import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import type { SearchPanel } from '@orden/contracts'
import { search, searchSpace, searchWarmth } from '../src/api'
import { changesFor } from '../src/apply'
import { selectedWords } from '../src/seed'

type Told = (found: { hits: object[]; loose: object[] }) => void
const row = (path: string) => ({ path, name: path, line: 1, text: 'tulip', ranges: [], score: 1 })
const space = ['/space/Plans.md', '/space/Team.chat', '/space/Trip/Crew.CHAT']
vi.mock('../../platform/src/api', async (actual) => ({
  ...(await actual<object>()),
  isNative: false,
  internal: { routed: false },
}))
vi.mock('../../pdf/src/api', async (actual) => ({
  ...(await actual<object>()),
  papers: () => Promise.resolve({ papersFor: () => Promise.resolve(), searchPapers: () => [row('/space/Team.chat')] }),
}))
vi.mock('../../web-backend/src/api', async (actual) => ({
  ...(await actual<object>()),
  searchInternal: () => Promise.resolve(false),
  searchInWorker: (_root: string, _query: unknown, _terms: string[], _limit: number, told: Told) => {
    told({ hits: space.map(row), loose: space.map(row) })
    return Promise.resolve()
  },
}))
vi.mock('../../away/src/api', () => ({
  keptAway: {
    search: (_root: string, _query: unknown, _terms: string[], _limit: number, told: Told) => {
      told({ hits: space.map(row), loose: space.map(row) })
      return Promise.resolve(true)
    },
  },
}))
const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
test('the module stands on its own loads the selection, the space search and the panel store with it, and the rest through doors', () => {
  const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
  const loaded = [...api.matchAll(/^export \{[^}]*\} from '([^']+)'/gm)].map((one) => one[1])
  expect(loaded).toEqual(['./space', './panel.svelte'])
  expect(api).toMatch(/import\('\.\/SearchPanel\.svelte'\)/)
  expect(api).toMatch(/import\('\.\/warm\.svelte'\)/)
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
  const hit = (path: string, line: number) => {
    const text = (notes[path]?.split('\n')[line] ?? '').trim()
    return { path, name: path, line, text, ranges: [] }
  }
  const alpha = { kind: 'text', text: 'alpha', fold: true } as const
  test('changes the lines that were hit in notes, and says how to put each back', async () => {
    const made = await changesFor(
      alpha,
      [hit('/space/One.md', 0), hit('/space/Link.url', 0)],
      'gamma',
      '/space',
      (path) => Promise.resolve(notes[path] ?? null),
    )
    expect(made.map((one) => [one.path, one.after])).toEqual([['/space/One.md', 'gamma here\nbeta\nalpha again\n']])
    expect(made[0]?.back).toEqual([{ from: 0, to: 5, insert: 'alpha' }])
  })
  test('changes nothing in a note that is gone', async () => {
    const made = await changesFor(alpha, [hit('/space/One.md', 0)], 'gamma', '/space', () => Promise.resolve(null))
    expect(made).toEqual([])
  })
})
describe('a note search', () => {
  test('never shows a chat, whatever the notes it reads hand it', async () => {
    const hits: string[] = []
    const loose: string[] = []
    await searchSpace('/space', { kind: 'text', text: 'tulip', fold: true }, ['tulip'], 50, (found) => {
      hits.push(...found.hits.map((one) => one.path))
      loose.push(...found.loose.map((one) => one.path))
    })
    expect(hits).toEqual(['/space/Plans.md', '/space/Plans.md'])
    expect(loose).toEqual(['/space/Plans.md', '/space/Plans.md'])
  })
})
describe("the search's hold on a space", () => {
  test('says nothing before a space is warmed', async () => {
    expect((await searchWarmth()).said).toBeUndefined()
  })
})
describe('the search panel', () => {
  test("is one store that keeps the search panel's promises", () => {
    const panel: SearchPanel = search
    expect(panel).toBe(search)
  })
  test('runs nothing for words too short to be a search', () => {
    search.ask('a')
    expect(search.running).toBe(false)
    expect(search.hits).toEqual([])
    search.clear()
  })
  test('turns a sort around when it is asked for twice', () => {
    search.setSort('name')
    expect(search.ordering).toEqual({ sort: 'name', descending: false })
    search.setSort('name')
    expect(search.ordering).toEqual({ sort: 'name', descending: true })
    search.setSort('relevance')
  })
})
