import { expect, test, vi } from 'vitest'

const task = (path: string, tags: string[]) => ({
  kind: 'task',
  space: 'Home',
  path,
  task: { tags },
})

const open = [task('Plans.md', ['work'])]
const all = [...open, task('Diary.md', ['therapy'])]

vi.mock('../workspace.svelte', () => ({ workspace: { spaces: [{ name: 'Home', root: '/s' }] } }))
vi.mock('../sharing.svelte', () => ({ canWriteAt: () => true }))
vi.mock('./act', () => ({ writeEach: () => Promise.resolve(true) }))
vi.mock('../rows/rows.svelte', () => ({ rows: { of: () => all, shown: () => open } }))

const { labelEntries } = await import('./task-actions')

test('the Labels menu offers no label that only a shut protected note wears', () => {
  const rows = open as unknown as Parameters<typeof labelEntries>[0]
  expect(labelEntries(rows).map((one) => one?.label)).toEqual(['#work'])
})
