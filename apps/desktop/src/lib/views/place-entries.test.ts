import { expect, test, vi } from 'vitest'

vi.mock('../workspace.svelte', () => ({
  workspace: { activeSpace: { root: '/s' }, notes: [], tree: null },
}))
vi.mock('../sharing.svelte', () => ({ canWriteAt: () => true }))
vi.mock('./act', () => ({ rewriteNotes: () => Promise.resolve() }))
vi.mock('../rows/rows.svelte', () => ({ rows: {} }))
vi.mock('../rows/todo-lists', () => ({
  listsIn: () => [
    'Projects/Work/Ideas.md',
    'Projects/Home/Ideas.md',
    'Projects/Garden.md',
    'Lists/Ideas.md',
  ],
  makeList: () => undefined,
}))

const { placeEntries } = await import('./project-actions')

test('lists of one name in Move to are told apart by where they are', () => {
  expect(placeEntries(() => undefined).map((one) => one?.label)).toEqual([
    'Inbox',
    'Garden',
    'Home / Ideas',
    'Lists / Ideas',
    'Work / Ideas',
  ])
})
