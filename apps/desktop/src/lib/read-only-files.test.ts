import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The file list's gestures in a space shared with this account to be read.
 *
 *  Making, renaming, deleting, duplicating and moving all write into the space, and
 *  a space shared to be read is one nothing may be written in: the copy here would
 *  stop being the space's, and the sync refuses it on every pass (B273). The menus
 *  and keys do not offer them there, and the workspace's own calls refuse them as
 *  well, for every caller that did not look.
 *
 *  Two spaces on a map of a disk, and the share is one set of roots the sharing
 *  module answers from. Every command the disk is asked is logged, so a refusal can
 *  be told from a write that failed. */

const files = new Map<string, string>()
const asked: string[] = []
const readOnly = vi.hoisted(() => new Set<string>())

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const ROOTS = ['/theirs', '/mine']

function listing(root: string) {
  const children = [...files.keys()]
    .filter((one) => one.startsWith(`${root}/`))
    .map((one) => ({
      name: one.split('/').pop() ?? one,
      path: one,
      is_dir: false,
      modified: 0,
      created: 0,
      children: [],
    }))
  return { name: root.slice(1), path: root, is_dir: true, modified: 0, created: 0, children }
}

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    asked.push(command)
    const path = text(args?.path)
    switch (command) {
      case 'read_note': {
        const held = files.get(path)
        if (held === undefined) throw new Error(`no such note: ${path}`)
        return held
      }
      case 'write_note':
        files.set(path, text(args?.content))
        return undefined
      case 'rename_note': {
        const from = text(args?.from)
        const held = files.get(from)
        if (held === undefined) throw new Error(`no such note: ${from}`)
        files.delete(from)
        files.set(text(args?.to), held)
        return undefined
      }
      case 'delete_note':
        files.delete(path)
        return undefined
      case 'trash_item':
        files.delete(path)
        return { id: 't' }
      case 'read_tree': {
        // As the crate does: a root that is not a folder is refused.
        const root = text(args?.root)
        if (!ROOTS.includes(root)) throw new Error('root is not a directory')
        return listing(root)
      }
      case 'file_stamp':
        return files.has(path) ? { modified: 1, len: 1 } : null
      default:
        return undefined
    }
  },
}))

vi.mock('./sharing.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sharing.svelte')>()),
  canWriteAt: (path: string) =>
    ![...readOnly].some((root) => path === root || path.startsWith(`${root}/`)),
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

/** What the disk was asked to change, rather than to say. */
const WRITES = /write|rename|delete|trash|copy|create|move|snapshot|bring|remove/
const writes = () => asked.filter((command) => WRITES.test(command))

beforeEach(async () => {
  files.clear()
  files.set('/theirs/Plan.md', '# Plan')
  files.set('/mine/Mine.md', '# Mine')
  readOnly.clear()
  workspace.spaces = [
    { id: 'theirs', name: 'Theirs', root: '/theirs' },
    { id: 'mine', name: 'Mine', root: '/mine' },
  ]
  workspace.activeSpaceId = 'theirs'
  workspace.tabs = []
  await workspace.loadTree()
  asked.length = 0
})

const before = () => [...files.entries()].sort()

describe('in a space that may be written in', () => {
  test('a note is made, renamed and deleted', async () => {
    await workspace.createNote('/theirs', 'New.md')
    expect(files.has('/theirs/New.md')).toBe(true)

    await workspace.rename('/theirs/New.md', 'Other.md')
    expect(files.has('/theirs/Other.md')).toBe(true)

    await workspace.loadTree()
    await workspace.remove('/theirs/Other.md', false)
    expect(files.has('/theirs/Other.md')).toBe(false)
  })
})

describe('in a space shared to be read', () => {
  beforeEach(() => {
    readOnly.add('/theirs')
  })

  test('no note or canvas is made, named or not', async () => {
    const was = before()

    await workspace.createNote()
    await workspace.createNote('/theirs')
    await workspace.createNote('/theirs', 'New.md')
    await workspace.createCanvas('/theirs', 'Board.canvas')
    await workspace.createCanvas()

    expect(before()).toEqual(was)
    expect(writes()).toEqual([])
    expect(workspace.naming).toBeNull()
    expect(workspace.tabs).toEqual([])
  })

  test('no note is made inside another', async () => {
    const was = before()

    await workspace.createInside('/theirs/Plan.md')

    expect(before()).toEqual(was)
    expect(writes()).toEqual([])
  })

  test('nothing is renamed, deleted or duplicated', async () => {
    const was = before()

    await workspace.rename('/theirs/Plan.md', 'Other.md')
    await workspace.remove('/theirs/Plan.md', false)
    await workspace.removeMany(['/theirs/Plan.md'])
    await workspace.duplicate('/theirs/Plan.md')
    await workspace.duplicateMany(['/theirs/Plan.md'])

    expect(before()).toEqual(was)
    expect(writes()).toEqual([])
    expect(workspace.entryAt('/theirs/Plan.md')).not.toBeNull()
  })

  test('nothing moves out of it, nor into it', async () => {
    const was = before()

    await workspace.moveMany(['/theirs/Plan.md'], '/mine')
    await workspace.move('/theirs/Plan.md', '/mine')
    await workspace.moveMany(['/mine/Mine.md'], '/theirs')
    await workspace.move('/mine/Mine.md', '/theirs')
    await workspace.copyMany(['/mine/Mine.md'], '/theirs')

    expect(before()).toEqual(was)
    expect(writes()).toEqual([])
  })
})

/** The tab in front, read again after a call that changed it. */
const front = () => workspace.active

/** A tab with no file given one: a draft written, a web tab kept as a web note. Each
 *  is a new file in the place it is saved to (B295). */
describe('a tab saved into a space shared to be read', () => {
  beforeEach(() => {
    readOnly.add('/theirs')
  })

  test('writes no draft, where it was asked to or in its own space', async () => {
    await workspace.newCanvas()
    const tab = workspace.active
    if (!tab) throw new Error('no draft')

    expect(await workspace.save(tab, '/theirs', 'Board.canvas')).toBeNull()
    expect(await workspace.save(tab)).toBeNull()
    expect(tab.path).toBeNull()
    expect(writes()).toEqual([])
  })

  test('keeps no web tab as a web note there', async () => {
    workspace.openWebsite()
    const tab = workspace.active
    if (!tab) throw new Error('no web tab')
    tab.address = 'https://example.com/'

    expect(await workspace.save(tab, '/theirs')).toBeNull()
    expect(tab.path).toBeNull()
    expect(writes()).toEqual([])
  })

  test('nor do the two ways a tab is given a file, asked on their own', async () => {
    const { keepWeb } = await import('./workspace/placing')
    workspace.openWebsite()
    const web = workspace.active
    if (!web) throw new Error('no web tab')
    web.address = 'https://example.com/'
    expect(await keepWeb(workspace, (_path, run) => run(), web, '/theirs')).toBeNull()

    await workspace.newCanvas()
    const draft = front()
    if (!draft) throw new Error('no draft')
    const { saving } = workspace as unknown as {
      saving: { place: (note: unknown, folder: string, file: string) => Promise<string | null> }
    }
    expect(await saving.place(draft.note, '/theirs', 'Board.canvas')).toBeNull()
    expect(writes()).toEqual([])
  })

  test('while one saved into the reader’s own space is written', async () => {
    await workspace.newCanvas()
    const tab = workspace.active
    if (!tab) throw new Error('no draft')

    expect(await workspace.save(tab, '/mine', 'Board.canvas')).toBe('/mine/Board.canvas')
  })
})

describe('a link to a note the space has not got', () => {
  const unresolved = { path: null, target: 'Missing', heading: null, block: null, page: null }

  test('makes the note in a space that may be written in', async () => {
    await workspace.followLink(unresolved)
    expect(files.has('/theirs/Missing.md')).toBe(true)
  })

  test('makes nothing in a space shared to be read, followed or aside', async () => {
    readOnly.add('/theirs')
    const was = before()

    await workspace.followLink(unresolved)
    await workspace.followLink(unresolved, 'aside')

    expect(before()).toEqual(was)
    expect(writes()).toEqual([])
    expect(workspace.tabs).toEqual([])
  })
})

describe('an open note in a space shared to be read', () => {
  /** What the autosave owes, written: it waits a pause after the last change. */
  async function settle() {
    await vi.advanceTimersByTimeAsync(3000)
    await workspace.writesSettled()
  }

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await workspace.open('/theirs/Plan.md')
    readOnly.add('/theirs')
    asked.length = 0
    return () => vi.useRealTimers()
  })

  test('takes no version put back from its history', async () => {
    const tab = workspace.active
    if (!tab) throw new Error('Plan.md did not open')

    await workspace.restoreVersion('# An old plan', tab)
    await settle()

    expect(files.get('/theirs/Plan.md')).toBe('# Plan')
    expect(tab.note.text).toBe('# Plan')
    expect(writes()).toEqual([])
  })

  // The owner's words reach a reader's open note through the document, as a room
  // and sync v2 bring them, and the autosave is what puts them on the disk. So the
  // write itself cannot refuse a space shared to be read; only the gestures can.
  test('still writes what the owner changed to its file', async () => {
    const tab = workspace.active
    if (!tab) throw new Error('Plan.md did not open')

    tab.note.live.arrived([{ from: 6, to: 6, insert: ' for May' }])
    await settle()

    expect(files.get('/theirs/Plan.md')).toBe('# Plan for May')
  })
})

describe('a PDF opened with the app from outside', () => {
  test('is not brought into a space shared to be read', async () => {
    readOnly.add('/theirs')
    const was = before()

    expect(await workspace.bringInPdf('/elsewhere/paper.pdf', '/theirs')).toBeNull()

    expect(before()).toEqual(was)
    expect(writes()).toEqual([])
  })
})
