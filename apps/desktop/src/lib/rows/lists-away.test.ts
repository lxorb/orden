import { expect, test, vi } from 'vitest'

vi.mock('../workspace.svelte', () => ({
  workspace: {
    tree: { path: '/s/Home' },
    notes: [{ path: '/s/Home/Errands.md' }, { path: '/s/Home/Diary.md' }],
    itemMeta: {
      of: (path: string) => (/(Errands|Shop)\.md$/.test(path) ? { 'todo-list': 'yes' } : null),
      listsMarked: () => true,
    },
  },
}))

const { listsIn, notesAwayBy } = await import('./todo-lists')

test('the lists of a space not on screen are its own, read from its rows', () => {
  notesAwayBy((root) => (root === '/s/Work' ? ['Shop.md', 'Plans.md', 'Board.canvas'] : []))

  expect(listsIn('/s/Home')).toEqual(['Errands.md'])
  expect(listsIn('/s/Work')).toEqual(['Shop.md'])
})
