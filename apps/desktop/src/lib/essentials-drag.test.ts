import { beforeEach, describe, expect, test, vi } from 'vitest'

/** A file dragged from the file list into the Essentials, and a tile dragged back out
 *  into a folder of the list (#412): each one step to undo and to do again. The store is
 *  the real one; the disk is a stand-in that records what it was asked. */

const sent: { command: string; from?: unknown; to?: unknown }[] = []

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: (command: string, args?: Record<string, unknown>) => {
    sent.push({ command, from: args?.from, to: args?.to })
    if (command === 'read_note') return Promise.resolve('# a')
    return Promise.resolve(undefined)
  },
}))

function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('./workspace.svelte')
const { place, unkeepInto } = await import('./essentials.svelte')
type Entry = import('./workspace.svelte').Entry

const file = (path: string): Entry => ({
  name: path.split('/').pop() ?? path,
  path,
  is_dir: false,
  modified: 0,
  created: 0,
  children: [],
})
const folder = (path: string, children: Entry[]): Entry => ({
  ...file(path),
  is_dir: true,
  children,
})

const kept = () =>
  workspace.bookmarks.list.filter((one) => one.kind === 'note').map((one) => one.path)

beforeEach(() => {
  sent.length = 0
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tree = folder('/space', [
    file('/space/a.md'),
    file('/space/b.md'),
    folder('/space/Work', [file('/space/Work/c.md')]),
  ])
  workspace.bookmarks.put('/space', [])
  workspace.undone.stack = []
  workspace.undone.ahead = []
})

describe('a file dragged into the Essentials', () => {
  test('leaves the list for a tile, a selection at once, and one undo puts both back', async () => {
    place(
      [file('/space/a.md'), file('/space/b.md')].map(
        (one) => workspace.bookmarks.forEntry(one) ?? { kind: 'note', path: '', text: '' },
      ),
      0,
    )
    expect(kept()).toEqual(['a.md', 'b.md'])
    expect(workspace.inEssentials('/space/a.md')).toBe(true)
    expect(workspace.undone.last?.kind).toBe('keep')

    await workspace.undoFileAction()
    expect(kept()).toEqual([])
    await workspace.redoFileAction()
    expect(kept()).toEqual(['a.md', 'b.md'])
  })
})

describe('a tile dragged into the list', () => {
  test('leaves the Essentials and lands in the folder it was let go of in, one step', async () => {
    workspace.bookmarks.put('/space', [{ kind: 'note', path: 'a.md', text: '' }])
    await unkeepInto(0, '/space/Work')

    expect(kept()).toEqual([])
    expect(sent.find((one) => one.command === 'rename_note')).toMatchObject({
      from: '/space/a.md',
      to: '/space/Work/a.md',
    })
    expect(workspace.undone.last).toMatchObject({
      kind: 'many',
      steps: [{ kind: 'keep' }, { kind: 'move', from: '/space/a.md', to: '/space/Work/a.md' }],
    })
    expect(workspace.isExpanded('/space/Work')).toBe(true)

    sent.length = 0
    await workspace.undoFileAction()
    expect(kept()).toEqual(['a.md'])
    expect(sent.find((one) => one.command === 'rename_note')).toMatchObject({
      from: '/space/Work/a.md',
      to: '/space/a.md',
    })
  })

  test('let go of in the folder it is in, only leaves the Essentials', async () => {
    workspace.bookmarks.put('/space', [{ kind: 'note', path: 'a.md', text: '' }])
    await unkeepInto(0, '/space')
    expect(kept()).toEqual([])
    expect(sent.some((one) => one.command === 'rename_note')).toBe(false)
    expect(workspace.undone.last?.kind).toBe('keep')
  })

  test('takes nothing that is not a file', async () => {
    workspace.bookmarks.put('/space', [{ kind: 'search', path: '', text: 'tag:x' }])
    await unkeepInto(0, '/space/Work')
    expect(workspace.bookmarks.list).toHaveLength(1)
    expect(workspace.undone.stack).toEqual([])
  })
})
