import { describe, expect, test, vi } from 'vitest'
import type { FuzzyHit } from '@orden/scan/search/fuzzy'
import type { Hit } from '@orden/scan/search/match'

type Told = (found: { hits: Hit[]; loose: FuzzyHit[] }) => void

const guess = (path: string, score: number): FuzzyHit => ({
  path,
  name: path,
  line: 1,
  text: 'tulpi',
  ranges: [],
  score,
})
const hit = (path: string): Hit => ({ path, name: path, line: 1, text: 'tulip', ranges: [] })

vi.mock('../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/src/tauri')>()),
  isNative: false,
  internal: { routed: false },
}))
vi.mock('../pdf/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/src/api')>()),
  papers: () => Promise.resolve({ papersFor: () => Promise.resolve(), searchPapers: () => [] }),
}))
vi.mock('./inbox', () => ({ inboxHits: () => Promise.resolve([]) }))
vi.mock('../web/search-client', () => ({
  searchInWorker: (_root: string, _query: unknown, _terms: string[], limit: number, told: Told) => {
    told({
      hits: [hit('/space/Here.md')],
      loose: [guess('/space/a.md', 5), guess('/space/b.md', 1)].slice(0, limit),
    })
    return Promise.resolve()
  },
}))
vi.mock('../web/away.svelte', () => ({
  keptAway: {
    search: (_root: string, _query: unknown, _terms: string[], limit: number, told: Told) => {
      told({
        hits: [],
        loose: [guess('/space/away1.md', 9), guess('/space/away2.md', 2)].slice(0, limit),
      })
      told({
        hits: [],
        loose: [guess('/space/away3.md', 7), guess('/space/away4.md', 0)].slice(0, limit),
      })
      return Promise.resolve(true)
    },
  },
}))

await import('../workspace.svelte')
const { searchSpace } = await import('./space')

describe('a search in a browser that keeps some notes away', () => {
  test('shows the best guesses of all the notes together, no more of them than of its own', async () => {
    const hits: string[] = []
    const loose: string[] = []
    await searchSpace('/space', { kind: 'term', text: 'tulip' } as never, ['tulip'], 3, (found) => {
      hits.push(...found.hits.map((one) => one.path))
      loose.push(...found.loose.map((one) => one.path))
    })
    expect(hits).toEqual(['/space/Here.md'])
    expect(loose).toEqual(['/space/away1.md', '/space/away3.md', '/space/a.md'])
  })
})
