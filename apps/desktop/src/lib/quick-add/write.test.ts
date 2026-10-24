import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Where `>` sends a task, driven by a stand-in store and disk.
 *
 *  The note it names is made where the space has none, and making it was writing
 *  an empty file over the path. Where the name only missed the listing, that was
 *  a closed note's words gone: the file was there, under a spelling the listing
 *  was compared to wrongly, or not yet in a listing read a moment before. */

const { notes, disk, written } = vi.hoisted(() => ({
  notes: [] as { path: string; name: string }[],
  disk: new Map<string, string>(),
  written: [] as string[],
}))

vi.mock('../workspace.svelte', () => ({
  workspace: {
    notes,
    recent: [],
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

const { addTask } = await import('./write')

const task = (note: string) =>
  ({ text: 'buy milk', fields: { tags: [], remind: [] }, note }) as never

beforeEach(() => {
  notes.length = 0
  disk.clear()
  written.length = 0
})

describe('a task sent to a note by name', () => {
  test('finds a note whose name is stored decomposed, typed composed', async () => {
    // `Café` as a Mac keeps it, with the accent a character of its own, and as a
    // keyboard types it, with the accent in the letter.
    const stored = '/s/Café.md'
    notes.push({ path: stored, name: 'Café.md' })
    disk.set(stored, 'my words\n')

    const landed = await addTask(task('Café'), { root: '/s' })

    expect(landed?.path).toBe(stored)
    expect(written).toEqual([])
  })

  test('never writes over a note the listing has not caught up with', async () => {
    disk.set('/s/Plan.md', 'my words\n')

    const landed = await addTask(task('Plan'), { root: '/s' })

    expect(landed?.path).toBe('/s/Plan.md')
    expect(written).toEqual([])
    expect(disk.get('/s/Plan.md')).toBe('my words\n')
  })

  test('makes the note where there is none', async () => {
    const landed = await addTask(task('Ideas'), { root: '/s' })

    expect(landed?.path).toBe('/s/Ideas.md')
    expect(written).toEqual(['/s/Ideas.md'])
  })
})
