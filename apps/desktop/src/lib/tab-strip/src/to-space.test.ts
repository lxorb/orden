import { expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({ asked: [] as unknown[], answer: null as boolean | null }))
vi.mock('../../workspace/src/api', () => ({
  workspace: {
    tabs: [{ id: 't1', path: '/work/Plan.md', paneId: 'none' }],
    archivedSpaces: new Set<string>(),
    spaceOfTab: () => 'home',
  },
  mayCarry: () => true,
  movingOf: (tab: { path: string }) => ({ path: tab.path, home: null, shared: null }),
  spacesFor: (moving: unknown) => {
    world.asked.push(moving)
    return []
  },
  spaceMoving: () => Promise.resolve({ moveToSpace: () => Promise.resolve(world.answer) }),
}))
vi.mock('../../sharing/src/api', () => ({ canWriteAt: () => true }))
const { spacesOf, toSpace } = await import('./to-space')
type Tab = Parameters<typeof spacesOf>[0][number]
test('the spaces a tab may go to count the space the tab is in, not only its file', () => {
  spacesOf([{ id: 't1', path: '/work/Plan.md', paneId: 'none' } as unknown as Tab])
  expect(world.asked).toEqual([[{ path: '/work/Plan.md', home: null, shared: null, at: 'home' }]])
})
test('a move the reader cancels answers so, and a move made says it was', async () => {
  world.answer = null
  expect(await toSpace(['t1'], 'uni')).toBeNull()
  world.answer = true
  expect(await toSpace(['t1'], 'uni')).toBe(true)
})
