import { expect, test, vi } from 'vitest'
import type { Hit } from '@orden/scan/search/match'
import type { Query } from '@orden/scan/search/query'

const asked: { words: string; replacement: string }[] = []

vi.mock('./apply', () => ({
  changesFor: async (query: Query, _hits: unknown, replacement: string) => {
    asked.push({ words: JSON.stringify(query), replacement })
    return []
  },
}))

vi.mock('./space', () => ({ searchSpace: async () => undefined }))

vi.mock('../../scratchpad/src/api', async (original) => ({
  ...(await original<typeof import('../../scratchpad/src/api')>()),
  scratchpadHits: async () => [],
}))

const { workspace } = await import('../../workspace/src/api')
const { search } = await import('./panel.svelte')
const { parseQuery } = await import('@orden/scan/search/query')

const hit = (path: string): Hit => ({ path, name: path, line: 1, text: 'tulip', ranges: [] })

test('a replace uses the words and replacement it was pressed with, though they change while it loads', async () => {
  workspace.spaces = [{ id: 'a', name: 'A', root: '/space' }]
  workspace.activeSpaceId = 'a'
  search.text = 'tulip'
  search.replacement = 'rose'
  search.found = [hit('/space/Garden.md')]

  const going = search.replace()
  search.text = 'daisy'
  search.replacement = 'lily'
  await going

  expect(asked).toEqual([{ words: JSON.stringify(parseQuery('tulip')), replacement: 'rose' }])
  search.clear()
})
