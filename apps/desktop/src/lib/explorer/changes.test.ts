import { beforeEach, describe, expect, test, vi } from 'vitest'

const crate = {
  trashPaths: vi.fn((paths: string[]) =>
    Promise.resolve(paths.map((path) => ({ path, back: path, at: 1 }))),
  ),
  renameTo: vi.fn((path: string, name: string) =>
    Promise.resolve(`${path.slice(0, path.lastIndexOf('/'))}/${name}`),
  ),
  makeIn: vi.fn((folder: string, name: string) => Promise.resolve(`${folder}/${name}`)),
  clashesIn: vi.fn((): Promise<string[]> => Promise.resolve([])),
  transfer: vi.fn((_job: string, sources: string[], folder: string) =>
    Promise.resolve({
      done: sources.map((from) => ({
        from,
        to: `${folder}/${from.slice(from.lastIndexOf('/') + 1)}`,
      })),
      replaced: [],
      skipped: [],
      failed: [],
      cancelled: false,
    }),
  ),
  deleteForGood: vi.fn(() => Promise.resolve()),
  listFolder: vi.fn(() => Promise.reject(new Error('not a folder'))),
}
vi.mock('./commands', () => crate)

const recorded: unknown[] = []
const workspace = {
  spaces: [{ root: '/home/me/Orden/Work' }],
  undone: {
    record: (action: unknown) => recorded.push(action),
    batch: async (work: () => Promise<unknown>) => work(),
  },
  removeMany: vi.fn(() => Promise.resolve()),
  rename: vi.fn(() => Promise.resolve()),
  moveMany: vi.fn(() => Promise.resolve(true)),
  copyMany: vi.fn(() => Promise.resolve()),
  bringIn: vi.fn(() => Promise.resolve()),
  loadTree: vi.fn(() => Promise.resolve()),
}
vi.mock('../workspace.svelte', () => ({ workspace }))

vi.mock('../list-landing.svelte', () => ({
  fileClipboard: { paths: [], cut: false, hold: vi.fn() },
}))

const asked: string[] = []
let answer: string | null = 'keep'
vi.mock('../prompt.svelte', () => ({
  prompt: {
    choose: (question: { title: string }) => {
      asked.push(question.title)
      return Promise.resolve(answer)
    },
    confirm: () => Promise.resolve(true),
  },
}))

const { carry, freeName, renameMany, renamePath, removeForGood, trash } = await import('./changes')

function view(path = '/home/me/Downloads') {
  return {
    listing: { path, own: false, spaces: false, entries: [], parent: null, cut: false },
    names: [] as string[],
    renaming: null as string | null,
    reload: vi.fn(() => Promise.resolve()),
    pick: vi.fn(),
    tell: vi.fn(),
  }
}

beforeEach(() => {
  recorded.length = 0
  asked.length = 0
  answer = 'keep'
  vi.clearAllMocks()
})

describe("a file explorer's changes", () => {
  test('name a new thing after the first free number', () => {
    expect(freeName(['a', 'New folder'], 'New folder')).toBe('New folder 2')
    expect(freeName(['new folder', 'New folder 2'], 'New folder')).toBe('New folder 3')
    expect(freeName([], 'New folder')).toBe('New folder')
  })

  test('put what is outside the spaces in the system trash, one undo for it', async () => {
    await trash(view() as never, ['/home/me/Downloads/a.zip', '/home/me/Downloads/b.zip'])
    expect(crate.trashPaths).toHaveBeenCalledWith([
      '/home/me/Downloads/a.zip',
      '/home/me/Downloads/b.zip',
    ])
    expect(recorded).toEqual([
      {
        kind: 'outside',
        steps: [
          {
            op: 'trashed',
            tickets: [
              { path: '/home/me/Downloads/a.zip', back: '/home/me/Downloads/a.zip', at: 1 },
              { path: '/home/me/Downloads/b.zip', back: '/home/me/Downloads/b.zip', at: 1 },
            ],
          },
        ],
      },
    ])
  })

  test("hand what is in a space to the file list's own delete", async () => {
    const inside = view('/home/me/Orden/Work')
    inside.listing.spaces = true
    await trash(inside as never, ['/home/me/Orden/Work/plan.md'])
    expect(workspace.removeMany).toHaveBeenCalledWith(['/home/me/Orden/Work/plan.md'])
    expect(crate.trashPaths).not.toHaveBeenCalled()
  })

  test('change nothing in a folder of Orden’s own', async () => {
    const own = view('/home/me/.config/orden')
    own.listing.own = true
    await trash(own as never, ['/home/me/.config/orden/agents.json'])
    await removeForGood(own as never, ['/home/me/.config/orden/agents.json'])
    expect(crate.trashPaths).not.toHaveBeenCalled()
    expect(crate.deleteForGood).not.toHaveBeenCalled()
  })

  test('record a rename as where it went', async () => {
    await renamePath(view() as never, '/home/me/Downloads/a.txt', 'b.txt')
    expect(recorded).toEqual([
      {
        kind: 'outside',
        steps: [
          {
            op: 'moved',
            pairs: [{ from: '/home/me/Downloads/a.txt', to: '/home/me/Downloads/b.txt' }],
          },
        ],
      },
    ])
  })

  test('ask once about names already there, and do nothing when not answered', async () => {
    crate.clashesIn.mockResolvedValueOnce(['a.txt', 'b.txt'])
    answer = null
    await carry(
      view() as never,
      ['/home/me/Music/a.txt', '/home/me/Music/b.txt'],
      '/home/me/Downloads',
      'copy',
    )
    expect(asked).toEqual(['2 names are already here'])
    expect(crate.transfer).not.toHaveBeenCalled()
  })

  test('copy out of a space, and move out of one as that copy and the file list’s delete', async () => {
    await carry(view() as never, ['/home/me/Orden/Work/plan.md'], '/home/me/Downloads', 'move')
    expect(crate.transfer).toHaveBeenCalledWith(
      expect.any(String),
      ['/home/me/Orden/Work/plan.md'],
      '/home/me/Downloads',
      'copy',
      'keep',
    )
    expect(workspace.removeMany).toHaveBeenCalledWith(['/home/me/Orden/Work/plan.md'])
    expect(recorded).toEqual([
      {
        kind: 'outside',
        steps: [
          {
            op: 'copied',
            pairs: [{ from: '/home/me/Orden/Work/plan.md', to: '/home/me/Downloads/plan.md' }],
          },
        ],
      },
    ])
  })

  test('bring a file from outside into a space as an import, and a move trashes the original', async () => {
    await carry(null, ['/home/me/Downloads/a.txt'], '/home/me/Orden/Work', 'move')
    expect(workspace.bringIn).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'a.txt' })],
      '/home/me/Orden/Work',
    )
    expect(crate.trashPaths).toHaveBeenCalledWith(['/home/me/Downloads/a.txt'])
    expect(crate.transfer).not.toHaveBeenCalled()
  })

  test('rename names that swap places through names of their own first, as one undo', async () => {
    await renameMany(view() as never, [
      { from: '/home/me/Downloads/a.txt', name: 'b.txt' },
      { from: '/home/me/Downloads/b.txt', name: 'a.txt' },
    ])
    expect(crate.renameTo.mock.calls.map(([path, name]) => `${path} ${name}`)).toEqual([
      '/home/me/Downloads/a.txt .orden-renaming-0',
      '/home/me/Downloads/b.txt .orden-renaming-1',
      '/home/me/Downloads/.orden-renaming-0 b.txt',
      '/home/me/Downloads/.orden-renaming-1 a.txt',
    ])
    expect(recorded).toEqual([
      {
        kind: 'outside',
        steps: [
          {
            op: 'moved',
            pairs: [
              { from: '/home/me/Downloads/a.txt', to: '/home/me/Downloads/b.txt' },
              { from: '/home/me/Downloads/b.txt', to: '/home/me/Downloads/a.txt' },
            ],
          },
        ],
      },
    ])
  })

  test('a swap of names that fails half way puts every name back as it was', async () => {
    const view_ = view()
    crate.renameTo.mockImplementation((path: string, name: string) =>
      name === 'a.txt'
        ? Promise.reject(new Error('a.txt is there already'))
        : Promise.resolve(`${path.slice(0, path.lastIndexOf('/'))}/${name}`),
    )
    await renameMany(view_ as never, [
      { from: '/home/me/Downloads/a.txt', name: 'b.txt' },
      { from: '/home/me/Downloads/b.txt', name: 'a.txt' },
    ])
    expect(crate.renameTo.mock.calls.slice(4).map(([path, name]) => `${path} ${name}`)).toEqual([
      '/home/me/Downloads/b.txt .orden-renaming-0',
      '/home/me/Downloads/.orden-renaming-0 a.txt',
      '/home/me/Downloads/.orden-renaming-1 b.txt',
    ])
    expect(view_.tell).toHaveBeenCalledWith('a.txt is there already')
    expect(recorded).toEqual([])
  })

  test('a rename of many in a space that fails says why rather than throwing', async () => {
    const view_ = view('/home/me/Orden/Work')
    workspace.rename.mockImplementationOnce(() =>
      Promise.reject(new Error('b.md is already there')),
    )
    await renameMany(view_ as never, [{ from: '/home/me/Orden/Work/a.md', name: 'b.md' }])
    expect(view_.tell).toHaveBeenCalledWith('b.md is already there')
    expect(view_.reload).toHaveBeenCalled()
  })
})
