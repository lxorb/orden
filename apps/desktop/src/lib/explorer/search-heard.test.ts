import { expect, test, vi } from 'vitest'

type Heard = (event: { payload: { job: string; found: unknown[] } }) => void

const ears = vi.hoisted(() => ({ heard: null as Heard | null }))

vi.mock('../platform/src/tauri', () => ({ isDesktop: true }))

vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_event: string, heard: Heard) => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    ears.heard = heard
    return () => undefined
  },
}))

vi.mock('./commands', () => ({
  FOUND: 'explorer://found',
  cancelJob: () => Promise.resolve(),
  searchBelow: (job: string) => {
    ears.heard?.({
      payload: {
        job,
        found: [
          {
            within: '/home/me/letters',
            name: 'bank.txt',
            kind: 'file',
            folder: false,
            size: 1,
            modified: 0,
            created: 0,
            hidden: false,
          },
        ],
      },
    })
    return Promise.resolve({ found: 1, cut: false, cancelled: false })
  },
}))

const { Search } = await import('./search.svelte')

test('the first search after starting shows what it found at once', async () => {
  const search = new Search('/home/me', 'bank')
  await search.run(false)
  expect(search.found.map((one) => one.name)).toEqual(['letters/bank.txt'])
})
