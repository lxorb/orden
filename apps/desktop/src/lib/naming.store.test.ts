import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Naming a row, through the store that owns the tree.
 *
 *  What a name may be is naming.test.ts, which is pure. This is the other half:
 *  that making a note, a canvas or a folder puts a row in the list and writes
 *  nothing until that row has a name, that leaving the row empty makes nothing at
 *  all, that a rename in flight survives the listing sync brings and goes when
 *  the file does. The disk is a map, so what was written is a list of paths.
 *
 *  The store reads storage and the platform shim the moment it is made, so both
 *  are stood in for before it is imported. */

/** The disk: what is on it, and what the store asked of it. */
const files = new Map<string, string>()
const folders = new Set<string>()
const sent: string[] = []

const text = (value: unknown) => (typeof value === 'string' ? value : '')

interface Entry {
  name: string
  path: string
  is_dir: boolean
  modified: number
  created: number
  children: Entry[]
}

function entry(path: string, isFolder: boolean): Entry {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: isFolder,
    modified: 0,
    created: 0,
    children: [],
  }
}

/** The listing, built from the paths on the disk the way the crate builds it from
 *  a folder: folders first, then names in order. */
function listing(root: string): Entry {
  const tree = entry(root, true)
  const at = new Map<string, Entry>([[root, tree]])

  const folderFor = (path: string): Entry => {
    const found = at.get(path)
    if (found) return found

    const made = entry(path, true)
    at.set(path, made)
    folderFor(path.slice(0, path.lastIndexOf('/'))).children.push(made)
    return made
  }

  for (const path of [...folders].sort()) if (path.startsWith(`${root}/`)) folderFor(path)

  for (const path of [...files.keys()].sort()) {
    if (!path.startsWith(`${root}/`)) continue
    folderFor(path.slice(0, path.lastIndexOf('/'))).children.push(entry(path, false))
  }

  const order = (one: Entry): Entry => ({
    ...one,
    children: [...one.children]
      .sort((a, b) => (a.is_dir === b.is_dir ? 0 : a.is_dir ? -1 : 1))
      .map(order),
  })

  return order(tree)
}

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = text(args?.path)
    sent.push(`${command} ${path || text(args?.from)}`)

    switch (command) {
      case 'read_note':
        return files.get(path) ?? ''
      case 'write_note':
        files.set(path, text(args?.content))
        return undefined
      case 'create_folder':
        folders.add(path)
        return undefined
      case 'rename_note': {
        const from = text(args?.from)
        const to = text(args?.to)
        const was = files.get(from)
        if (was !== undefined) {
          files.delete(from)
          files.set(to, was)
        }
        if (folders.delete(from)) folders.add(to)
        return undefined
      }
      case 'read_tree':
        return listing(text(args?.root))
      default:
        return undefined
    }
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

/** Every path the list shows, in the order it shows them. */
function rows(): string[] {
  const out: string[] = []
  const walk = (one: { children: { path: string; children: unknown[] }[] }) => {
    for (const child of one.children) {
      out.push(child.path)
      walk(child as never)
    }
  }

  if (workspace.tree) walk(workspace.tree)
  return out
}

beforeEach(async () => {
  files.clear()
  folders.clear()
  sent.length = 0
  files.set('/space/Beta.md', '# Beta')
  folders.add('/space/Work')
  files.set('/space/Work/Plan.md', '# Plan')

  workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  workspace.naming = null
  workspace.panel = 'tree'
  await workspace.loadTree()
  sent.length = 0
})

describe('making a note', () => {
  test('puts a row in the list, in its sorted place, and writes nothing yet', async () => {
    await workspace.createNote()

    expect(workspace.naming).toEqual({
      path: '/space/Untitled.md',
      appending: false,
      making: 'note',
    })
    // Folders first, then the names in order: the row is where the listing would
    // put it rather than at the end of the list.
    expect(rows()).toEqual([
      '/space/Work',
      '/space/Work/Plan.md',
      '/space/Beta.md',
      '/space/Untitled.md',
    ])
    expect(sent).toEqual([])
    expect([...files.keys()]).not.toContain('/space/Untitled.md')
  })

  test('and the name that is typed is what makes it, and opens it', async () => {
    await workspace.createNote()
    await workspace.makeNamed('Second quarter.md')

    expect(files.get('/space/Second quarter.md')).toBe('# Second quarter\n\n')
    expect(workspace.naming).toBeNull()
    expect(workspace.active?.path).toBe('/space/Second quarter.md')

    // The row it was named on has gone with it; the note is the only one left.
    expect(rows()).not.toContain('/space/Untitled.md')
    expect(rows()).toContain('/space/Second quarter.md')
  })

  test('while cancelling takes the row away again and makes nothing', async () => {
    await workspace.createNote()
    workspace.cancelNaming()

    expect(workspace.naming).toBeNull()
    expect(rows()).not.toContain('/space/Untitled.md')
    expect(sent).toEqual([])
    expect(workspace.tabs).toHaveLength(0)
  })

  /** The plus at the end of the tab strip, and the one a phone puts over the note:
   *  a gesture that made nothing at all would read as a gesture that failed. */
  test('and with no list on screen it is made straight away, under a stepped name', async () => {
    workspace.panel = null
    await workspace.createNote()

    expect(workspace.naming).toBeNull()
    expect(files.get('/space/Untitled.md')).toBe('# Untitled\n\n')
  })

  test('and the name is stepped until it is free', async () => {
    files.set('/space/Untitled.md', '# Untitled')
    await workspace.loadTree()

    await workspace.createNote()
    expect(workspace.naming?.path).toBe('/space/Untitled 2.md')
  })
})

describe('making a folder', () => {
  test('names it on its row, inside the folder it belongs to, and opens that', async () => {
    await workspace.createFolder('/space/Work')

    expect(workspace.naming?.making).toBe('folder')
    expect(workspace.naming?.path).toBe('/space/Work/New folder')
    expect(workspace.isExpanded('/space/Work')).toBe(true)
    expect(rows()).toContain('/space/Work/New folder')
    expect(sent).toEqual([])
  })

  test('and the typed name is the folder that is made', async () => {
    await workspace.createFolder('/space/Work')
    await workspace.makeNamed('Archive')

    expect(folders.has('/space/Work/Archive')).toBe(true)
    expect(folders.has('/space/Work/New folder')).toBe(false)
    expect(workspace.naming).toBeNull()
  })
})

describe('making a canvas', () => {
  test('is the same gesture, and the file is written once it has a name', async () => {
    await workspace.createCanvas()
    expect(workspace.naming).toMatchObject({ path: '/space/Untitled.canvas', making: 'canvas' })

    await workspace.makeNamed('Board.canvas')
    expect(files.has('/space/Board.canvas')).toBe(true)
    expect(workspace.active?.kind).toBe('canvas')
  })
})

describe('renaming a row that exists', () => {
  test('moves the file and closes the field', async () => {
    workspace.startRenaming('/space/Beta.md')
    expect(workspace.naming).toEqual({
      path: '/space/Beta.md',
      appending: false,
      making: null,
    })

    await workspace.rename('/space/Beta.md', 'Gamma.md')

    expect(files.has('/space/Gamma.md')).toBe(true)
    expect(files.has('/space/Beta.md')).toBe(false)
    expect(workspace.naming).toBeNull()
  })

  /** The field is opened by a menu, by F2 and by making a note, and two of those
   *  can happen while the list is not what the sidebar is showing. */
  test('but only where there is a row to type in', () => {
    workspace.panel = 'search'
    workspace.startRenaming('/space/Beta.md')
    expect(workspace.naming).toBeNull()
  })

  /** The header is over every panel, so the space's name has a field wherever the
   *  sidebar is open; see Sidebar.svelte. */
  test('while a space is named in the header, which any open panel has', () => {
    workspace.panel = 'search'
    workspace.startRenaming('/space')
    expect(workspace.naming?.path).toBe('/space')

    workspace.panel = null
    workspace.naming = null
    workspace.startRenaming('/space')
    expect(workspace.naming).toBeNull()
  })
})

describe('a listing arriving while a name is being typed', () => {
  test('leaves the row being made where it is', async () => {
    await workspace.createNote('/space/Work')
    await workspace.loadTree()

    expect(workspace.naming?.path).toBe('/space/Work/Untitled.md')
    expect(rows()).toContain('/space/Work/Untitled.md')
  })

  test('and leaves a rename in flight alone', async () => {
    workspace.startRenaming('/space/Beta.md')
    await workspace.loadTree()

    expect(workspace.naming?.path).toBe('/space/Beta.md')
  })

  /** A note deleted on another machine, or by another window: the row is gone, so
   *  there is nothing left to rename and nothing to commit a name onto. */
  test('but cancels a rename whose file has gone', async () => {
    workspace.startRenaming('/space/Beta.md')
    files.delete('/space/Beta.md')
    await workspace.loadTree()

    expect(workspace.naming).toBeNull()
  })
})

describe('the names beside a row', () => {
  test('are what is in its folder, its own left out', () => {
    expect(workspace.namesBeside('/space/Beta.md')).toEqual(['Work'])
    expect(workspace.namesBeside('/space/Work/Plan.md')).toEqual([])
    expect(workspace.namesBeside('/space/Work')).toEqual(['Beta.md'])
  })
})
