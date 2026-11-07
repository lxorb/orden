import { expect, test, vi } from 'vitest'

vi.mock('../workspace.svelte', () => ({
  workspace: {
    activeSpace: { root: '/s' },
    spaces: [
      { name: 'Home', root: '/s' },
      { name: 'Work', root: '/w' },
    ],
    notes: [],
    tree: null,
  },
}))
vi.mock('../sharing.svelte', () => ({ canWriteAt: () => true }))
vi.mock('./act', () => ({ rewriteNotes: () => Promise.resolve() }))
vi.mock('../rows/rows.svelte', () => ({ rows: {} }))
vi.mock('../rows/todo-lists', () => ({
  listsIn: (root: string) =>
    root === '/w'
      ? ['Clients.md']
      : [
          'Projects/Work/Ideas.md',
          'Projects/Home/Ideas.md',
          'Projects/Garden.md',
          'Lists/Ideas.md',
        ],
  makeList: () => undefined,
}))

const { placeEntries } = await import('./project-actions')
const { moveEntries } = await import('./task-actions')

test('lists of one name in Move to are told apart by where they are', () => {
  expect(placeEntries(() => undefined).map((one) => one?.label)).toEqual([
    'Inbox',
    'Garden',
    'Home / Ideas',
    'Lists / Ideas',
    'Work / Ideas',
  ])
})

test('Move to offers a task the lists of its own space, not of the one on screen', () => {
  const task = (space: string) =>
    ({ kind: 'task', space, path: 'Clients.md', task: { text: 'Call' } }) as never
  expect(moveEntries([task('Work')]).map((one) => [one?.label, one?.checked])).toEqual([
    ['Inbox', false],
    ['Clients', true],
  ])
  expect(moveEntries([task('Work'), task('Home')])).toEqual([])
})
