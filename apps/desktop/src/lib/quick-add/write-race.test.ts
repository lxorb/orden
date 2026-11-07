import { describe, expect, test, vi } from 'vitest'

const { notes, disk, lists } = vi.hoisted(() => ({
  lists: new Set<string>(),
  notes: [] as { path: string; name: string }[],
  disk: new Map<string, string>(),
}))

const later = () => new Promise((done) => setTimeout(done, 5))

vi.mock('../workspace.svelte', () => ({
  workspace: {
    notes,
    recent: [],
    rootHolding: () => '/s',
    itemMeta: {
      of: (path: string) => (lists.has(path) ? { 'todo-list': 'yes' } : null),
      set: (path: string, patch: Record<string, string | null>) =>
        patch['todo-list'] ? lists.add(path) : lists.delete(path),
      listsMarked: () => true,
    },
    loadTree: later,
    fileCame: async (path: string) => {
      await later()
      notes.push({ path, name: path.split('/').pop() ?? path })
    },
  },
}))
vi.mock('../workspace/write-file', () => ({
  writeFile: async (path: string, content: string) => {
    await later()
    disk.set(path, content)
  },
}))
vi.mock('../workspace/note-text', () => ({
  noteText: async (_ws: unknown, path: string) => disk.get(path) ?? null,
  replaceInNotes: async (_ws: unknown, changes: { path: string; after: string }[]) => {
    await later()
    for (const one of changes) disk.set(one.path, one.after)
    return changes.length
  },
}))
vi.mock('../on-disk', () => ({ onDisk: async (path: string) => disk.has(path) }))
vi.mock('../link-index.svelte', () => ({ links: { held: () => [] } }))
vi.mock('../sharing.svelte', () => ({ canWriteAt: () => true }))

const { addTask } = await import('./write')

const task = (text: string, note: string) =>
  ({ text, fields: { tags: [], remind: [] }, note }) as never

describe('tasks added one after the other before the first has landed', () => {
  test('both go into the one new list they name', async () => {
    const first = addTask(task('Milk', 'Groceries'), { root: '/s' })
    while (!disk.has('/s/Projects/Groceries.md')) await new Promise((done) => setTimeout(done, 0))
    const second = addTask(task('Eggs', 'Groceries'), { root: '/s' })

    expect((await first)?.path).toBe('/s/Projects/Groceries.md')
    expect((await second)?.path).toBe('/s/Projects/Groceries.md')
    expect(disk.get('/s/Projects/Groceries.md')).toContain('Milk')
    expect(disk.get('/s/Projects/Groceries.md')).toContain('Eggs')
    expect([...disk.keys()]).toEqual(['/s/Projects/Groceries.md'])
  })
})
