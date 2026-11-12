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
vi.mock('../rows/home.svelte', () => ({ homeRoot: () => '/s' }))
vi.mock('./act', () => ({ rewriteNotes: () => Promise.resolve() }))
vi.mock('../rows/rows.svelte', () => ({ rows: {} }))

const { placeEntries } = await import('./project-actions')
const { moveEntries } = await import('./task-actions')

test('Move to offers the inbox and no note (#2103)', () => {
  expect(placeEntries(() => undefined).map((one) => one?.label)).toEqual(['Inbox'])
})

test('Move to offers a task the inbox of its own space, and nothing to tasks of two spaces', () => {
  const task = (space: string) =>
    ({ kind: 'task', space, path: '.orden-inbox.md', task: { text: 'Call' } }) as never
  expect(moveEntries([task('Work')]).map((one) => [one?.label, one?.checked])).toEqual([
    ['Inbox', false],
  ])
  expect(moveEntries([task('Work'), task('Home')])).toEqual([])
})
