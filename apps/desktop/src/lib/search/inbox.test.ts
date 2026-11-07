import { expect, test, vi } from 'vitest'

const ROOT = '/spaces/Work'
const disk = new Map([
  [`${ROOT}/.orden-inbox.md`, '- [ ] Call the dentist\n- [ ] Buy milk\n'],
  ['/spaces/Other/.orden-inbox.md', '- [ ] Call the dentist\n'],
])

vi.mock('../rows/home.svelte', () => ({ homeRoot: () => ROOT }))

vi.mock('../tauri', async (original) => ({
  ...(await original<typeof import('../tauri')>()),
  isNative: true,
  invoke: (command: string, args?: { path?: string }) => {
    if (command === 'read_note') {
      const held = disk.get(args?.path ?? '')
      return held === undefined ? Promise.reject(new Error('no such note')) : Promise.resolve(held)
    }
    return Promise.resolve()
  },
}))
vi.mock('../own-window', () => ({ hearHere: () => Promise.resolve(() => undefined) }))
vi.mock('../pdf/papers', () => ({
  papersFor: () => Promise.resolve(),
  searchPapers: () => [],
}))

const { searchSpace } = await import('./space')
const { parseQuery } = await import('@orden/scan/search/query')

test('a word in the account inbox is found in the home space only, named Inbox', async () => {
  const found: { path: string; name: string }[] = []
  await searchSpace(ROOT, parseQuery('dentist'), ['dentist'], 10, (one) =>
    found.push(...one.hits.map((hit) => ({ path: hit.path, name: hit.name }))),
  )
  expect(found).toEqual([{ path: `${ROOT}/.orden-inbox.md`, name: 'Inbox' }])
  const elsewhere: string[] = []
  await searchSpace('/spaces/Other', parseQuery('dentist'), ['dentist'], 10, (one) =>
    elsewhere.push(...one.hits.map((hit) => hit.path)),
  )
  expect(elsewhere).toEqual([])
})
