import { expect, test, vi } from 'vitest'

const kept = new Map<string, string>()
vi.stubGlobal('localStorage', {
  get length() {
    return kept.size
  },
  key: (at: number) => [...kept.keys()][at] ?? null,
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => void kept.set(key, value),
  removeItem: (key: string) => void kept.delete(key),
  clear: () => kept.clear(),
})
const pushed: string[] = []
vi.mock('../../space-kept/src/api', async (original) => ({
  ...(await original<typeof import('../../space-kept/src/api')>()),
  push: async (root: string, _save: unknown, heard?: (landed: boolean) => void) => {
    pushed.push(root)
    heard?.(true)
  },
}))
const { SpaceSorting } = await import('./arranged.svelte')
test('a sort that reached the account gives way when another device changes it', async () => {
  const sorting = new SpaceSorting(() => '/space')
  sorting.adopt('/space', 'name', 'account')
  sorting.set('manual')
  await new Promise((done) => setTimeout(done))
  expect(pushed).toEqual(['/space'])
  sorting.adopt('/space', 'modified-desc', 'account')
  await new Promise((done) => setTimeout(done))
  expect(sorting.of('/space')).toBe('modified-desc')
  expect(pushed).toEqual(['/space'])
})
