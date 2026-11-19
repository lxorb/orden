import { beforeEach, expect, test, vi } from 'vitest'
import type { Hit } from '@orden/scan/search/match'

const streams: ((hits: Hit[]) => void)[] = []
const ends: (() => void)[] = []
vi.mock('./space', () => ({
  searchSpace: (
    _root: string,
    _query: unknown,
    _terms: unknown,
    _most: number,
    batch: (found: { hits: Hit[]; loose: Hit[] }) => void,
  ) =>
    new Promise<void>((done) => {
      streams.push((hits) => batch({ hits, loose: [] }))
      ends.push(done)
    }),
}))
vi.mock('../../scratchpad/src/api', async (original) => ({
  ...(await original<typeof import('../../scratchpad/src/api')>()),
  scratchpadHits: async () => [],
}))
const { workspace } = await import('../../workspace/src/api')
const { search } = await import('./panel.svelte')
const hit = (path: string): Hit => ({ path, name: path, line: 1, text: 'tulip', ranges: [] })
const later = (ms: number) => new Promise((done) => setTimeout(done, ms))
const until = async (held: () => boolean) => {
  for (let tries = 0; !held() && tries < 1000; tries++) await later(5)
}
beforeEach(() => {
  workspace.spaces = [{ id: 'a', name: 'A', root: '/space' }]
  workspace.activeSpaceId = 'a'
})
test('showing the archive mid search leaves only the new search writing its hits', async () => {
  search.ask('tulip')
  await until(() => streams.length === 1)
  search.showArchived(true)
  await until(() => streams.length === 2)
  streams[0]?.([hit('/space/Old.md')])
  streams[1]?.([hit('/space/New.md')])
  ends[0]?.()
  await later(20)
  expect(search.found.map((one) => one.path)).toEqual(['/space/New.md'])
  expect(search.running).toBe(true)
  ends[1]?.()
  await until(() => !search.running)
  expect(search.running).toBe(false)
  search.clear()
})
