import { beforeEach, describe, expect, test, vi } from 'vitest'

const { notes, disk, written, told, lists } = vi.hoisted(() => ({
  lists: new Set<string>(),
  notes: [] as { path: string; name: string }[],
  disk: new Map<string, string>(),
  written: [] as string[],
  told: [] as string[],
}))

vi.mock('../workspace.svelte', () => ({
  workspace: {
    notes,
    recent: [],
    rootHolding: (path: string) => '/' + (path.split('/')[1] ?? ''),
    itemMeta: {
      of: (path: string) => (lists.has(path) ? { 'todo-list': 'yes' } : null),
      set: (path: string, patch: Record<string, string | null>) =>
        patch['todo-list'] ? lists.add(path) : lists.delete(path),
    },
    loadTree: async () => undefined,
    fileCame: async () => undefined,
  },
}))
vi.mock('../workspace/write-file', () => ({
  writeFile: async (path: string, content: string) => {
    written.push(path)
    disk.set(path, content)
  },
}))
vi.mock('../workspace/note-text', () => ({
  noteText: async (_ws: unknown, path: string) => disk.get(path) ?? null,
  replaceInNotes: async () => undefined,
}))
vi.mock('../on-disk', () => ({ onDisk: async (path: string) => disk.has(path) }))
vi.mock('../link-index.svelte', () => ({ links: { held: () => [] } }))
vi.mock('../sharing.svelte', () => ({ canWriteAt: () => true }))

vi.mock('../reserved-name.svelte', () => ({
  reservedName: { tell: (root: string) => told.push(root) },
}))

const { addTask } = await import('./write')

const task = (note: string) =>
  ({ text: 'buy milk', fields: { tags: [], remind: [] }, note }) as never

const listed = (path: string) => {
  notes.push({ path, name: path.split('/').pop() ?? path })
  lists.add(path)
}

beforeEach(() => {
  lists.clear()
  notes.length = 0
  disk.clear()
  written.length = 0
  told.length = 0
})

describe('a task sent to a note by name', () => {
  test('finds a note whose name is stored decomposed, typed composed', async () => {
    const stored = '/s/Café.md'
    listed(stored)
    disk.set(stored, 'my words\n')

    const landed = await addTask(task('Café'), { root: '/s' })

    expect(landed?.path).toBe(stored)
    expect(written).toEqual([])
  })

  test('never writes over a note the listing has not caught up with', async () => {
    disk.set('/s/Projects/Plan.md', 'my words\n')

    expect(await addTask(task('Plan'), { root: '/s' })).toBeNull()
    expect(written).toEqual([])
    expect(disk.get('/s/Projects/Plan.md')).toBe('my words\n')
    expect(lists.has('/s/Projects/Plan.md')).toBe(false)
  })

  test('makes a to-do list in the Projects folder where there is none (#1229)', async () => {
    const landed = await addTask(task('Ideas'), { root: '/s' })

    expect(landed?.path).toBe('/s/Projects/Ideas.md')
    expect(written).toEqual(['/s/Projects/Ideas.md'])
    expect(lists.has('/s/Projects/Ideas.md')).toBe(true)
  })

  test('never goes into a note that is no to-do list, its checkboxes left alone (#1229)', async () => {
    notes.push({ path: '/s/Meeting.md', name: 'Meeting.md' })
    disk.set('/s/Meeting.md', '- [ ] Ask about the budget\n')

    const landed = await addTask(task('Meeting'), { root: '/s' })

    expect(landed?.path).toBe('/s/Projects/Meeting.md')
    expect(disk.get('/s/Meeting.md')).toBe('- [ ] Ask about the budget\n')
    expect(lists.has('/s/Meeting.md')).toBe(false)
  })

  test('into another space finds the note of that space, not the open one of that name', async () => {
    listed('/open/Errands.md')
    listed('/other/Errands.md')
    disk.set('/open/Errands.md', 'the open space\n')
    disk.set('/other/Errands.md', 'the other space\n')

    const landed = await addTask(task('Errands'), { root: '/other' })

    expect(landed?.path).toBe('/other/Errands.md')
    expect(written).toEqual([])
  })
})

describe('a task sent to the name the space keeps for its instructions', () => {
  test.each([['AGENTS'], ['agents'], ['AGENTS.md']])('%s is refused and said', async (note) => {
    disk.set('/space/AGENTS.md', 'the instructions')
    await vi.waitFor(async () => {
      expect(await addTask(task(note), { root: '/space' })).toBeNull()
      expect(told).toContain('/space')
    })
    expect(disk.get('/space/AGENTS.md')).toBe('the instructions')
    expect(written).toEqual([])
  })

  test('and does not make them where there are none', async () => {
    expect(await addTask(task('AGENTS'), { root: '/space' })).toBeNull()
    expect(written).toEqual([])
    expect(disk.has('/space/AGENTS.md')).toBe(false)
  })

  test('a note in a folder under the name is a note, and is written to', async () => {
    listed('/space/sub/AGENTS.md')
    disk.set('/space/sub/AGENTS.md', 'a note')
    expect((await addTask(task('sub/AGENTS'), { root: '/space' }))?.path).toBe(
      '/space/sub/AGENTS.md',
    )
    expect(told).toEqual([])
  })

  test('a name nobody has in a folder is not made, as a link would not', async () => {
    expect(await addTask(task('sub/AGENTS'), { root: '/space' })).toBeNull()
    expect(written).toEqual([])
  })
})
