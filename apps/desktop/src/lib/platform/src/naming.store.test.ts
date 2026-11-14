import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const files = new Map<string, string>()
const folders = new Set<string>()
const locked = new Set<string>()
const sent: string[] = []
const outside = new Map<string, string>()

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

function listing(root: string, papers = false): Entry {
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
    if (!papers && path.endsWith('.pages.pdf') && files.has(path.slice(0, -4))) continue
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
      case 'read_note': {
        if (locked.has(path))
          throw new Error(`could not read ${path}: stream did not contain valid UTF-8`)
        const held = files.get(path)
        if (held === undefined) throw new Error(`no such note: ${path}`)
        return held
      }
      case 'write_note':
        files.set(path, text(args?.content))
        return undefined
      case 'create_folder':
        folders.add(path)
        return undefined
      case 'rename_note': {
        const from = text(args?.from)
        const to = text(args?.to)
        const held = [...files.keys(), ...folders].some(
          (one) =>
            one.toLowerCase() === to.toLowerCase() && one.toLowerCase() !== from.toLowerCase(),
        )
        if (held) throw new Error('something already lives there')
        const holder = to.replace(/\.pdf$/i, '')
        if (/\.pages\.pdf$/i.test(to) && files.has(holder) && args?.hold !== true) {
          throw new Error(`${holder} is already there`)
        }
        const was = files.get(from)
        if (was !== undefined) {
          files.delete(from)
          files.set(to, was)
        }
        if (folders.delete(from)) folders.add(to)
        const paper = files.get(`${from}.pdf`)
        if (from.endsWith('.pages') && paper !== undefined) {
          files.delete(`${from}.pdf`)
          files.set(`${to}.pdf`, paper)
        }
        return undefined
      }
      case 'write_bytes':
        files.set(
          path,
          args?.bytes instanceof Uint8Array
            ? String.fromCharCode(...args.bytes)
            : atob(text(args?.base64)),
        )
        return undefined
      case 'copy_path': {
        const from = text(args?.from)
        const to = text(args?.to)
        const under = (one: string, root: string) => one === root || one.startsWith(`${root}/`)
        if ([...files.keys(), ...folders].some((one) => under(one, to))) {
          throw new Error('something already lives there')
        }
        for (const [one, words] of [...files]) {
          if (under(one, from)) files.set(to + one.slice(from.length), words)
        }
        const paper = files.get(`${from}.pdf`)
        if (from.endsWith('.pages') && paper !== undefined) files.set(`${to}.pdf`, paper)
        for (const one of [...folders])
          if (under(one, from)) folders.add(to + one.slice(from.length))
        return undefined
      }
      case 'delete_note':
        files.delete(path)
        if (path.endsWith('.pages')) files.delete(`${path}.pdf`)
        return undefined
      case 'delete_folder':
        for (const one of [...files.keys()]) if (one.startsWith(`${path}/`)) files.delete(one)
        for (const one of [...folders]) {
          if (one === path || one.startsWith(`${path}/`)) folders.delete(one)
        }
        return undefined
      case 'trash_item': {
        const under = (one: string) => one === path || one.startsWith(`${path}/`)
        for (const one of [...files.keys()]) if (under(one)) files.delete(one)
        if (path.endsWith('.pages')) files.delete(`${path}.pdf`)
        for (const one of [...folders]) if (under(one)) folders.delete(one)
        return { id: `trash-${path}` }
      }
      case 'same_pdf': {
        const words = outside.get(text(args?.from))
        const root = text(args?.space)
        if (words === undefined) throw new Error('not handed to Orden')
        const there = [...files].find(([one, held]) => one.startsWith(`${root}/`) && held === words)
        return there?.[0] ?? null
      }
      case 'read_file': {
        const held = outside.get(path) ?? files.get(path)
        if (held === undefined) throw new Error(`no such file: ${path}`)
        return new TextEncoder().encode(held).buffer
      }
      case 'read_tree': {
        const root = text(args?.root)
        if (!folders.has(root) && ![...files.keys()].some((one) => one.startsWith(`${root}/`))) {
          throw new Error('root is not a directory')
        }
        const options = args?.options as { papers?: boolean } | undefined
        return listing(text(args?.root), options?.papers === true)
      }
      case 'file_stamp':
        return files.has(path) || locked.has(path) ? { modified: 1, len: 1 } : null
      default:
        return undefined
    }
  },
}))

vi.mock('../../pdf/document', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../pdf/document')>()),
  pageSizes: (path: string) =>
    (files.get(path) ?? outside.get(path))?.startsWith('%PDF')
      ? Promise.resolve([
          { width: 794, height: 1123 },
          { width: 816, height: 1056 },
        ])
      : Promise.reject(new Error(`${path} is not a PDF`)),
}))

const sheet = vi.hoisted(() => ({ asked: [] as string[], answer: null as string | null }))

vi.mock('../../ui-kit/src/prompt.svelte', () => ({
  prompt: {
    choose: (options: { title: string }) => {
      sheet.asked.push(options.title)
      return Promise.resolve(sheet.answer)
    },
  },
}))

vi.mock('../../save-place/src/api', () => ({
  askPlace: () => undefined,
  saveFront: () => undefined,
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

const { nameFault } = await import('./naming')
const { workspace } = await import('../../workspace.svelte')
const { sync } = await import('../../sync.svelte')
const { unread } = await import('../../unread.svelte')
const { account } = await import('../../accounts/src/account.svelte')
const { isDraft } = await import('../../workspace/drafts')
type RemoteSpace = import('../../accounts/src/routes').RemoteSpace

const dropped = (path: string, words: string) => ({
  name: path.split('/').pop() ?? path,
  webkitRelativePath: path.includes('/') ? path : '',
  arrayBuffer: () => Promise.resolve(new TextEncoder().encode(words).buffer),
})

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
  locked.clear()
  unread.dismiss()
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

describe('making a note inside a note', () => {
  test('nests the note it goes inside first, and names the new one on its row', async () => {
    await workspace.createInside('/space/Beta.md')

    expect(files.has('/space/Beta/Beta.md')).toBe(true)
    expect(files.has('/space/Beta.md')).toBe(false)
    expect(workspace.naming?.path).toBe('/space/Beta/Untitled.md')
    expect(workspace.isExpanded('/space/Beta')).toBe(true)
  })

  test('and the name that was typed makes the nested note', async () => {
    await workspace.createInside('/space/Beta.md')
    await workspace.makeNamed('Monday.md')

    expect(files.has('/space/Beta/Monday.md')).toBe(true)
    expect(workspace.naming).toBeNull()
  })

  test('while a folder only gets the note, and no note of its own', async () => {
    await workspace.createInside('/space/Work')

    expect(workspace.naming?.path).toBe('/space/Work/Untitled.md')
    expect(files.has('/space/Work/Work.md')).toBe(false)
    expect(sent.filter((one) => one.startsWith('write_note'))).toEqual([])
  })

  test('and a file that can hold nothing gets nothing at all', async () => {
    files.set('/space/paper.pdf', '%PDF')
    await workspace.loadTree()

    await workspace.createInside('/space/paper.pdf')
    expect(workspace.naming).toBeNull()
  })
})

describe('opening a row that is a folder', () => {
  test('opens the note it holds of its own name', async () => {
    files.set('/space/Work/Work.md', '# Work')
    await workspace.loadTree()

    await workspace.openRow('/space/Work')
    expect(workspace.active?.path).toBe('/space/Work/Work.md')
  })

  test('and opens the empty page it would be where it holds none, writing nothing', async () => {
    await workspace.openRow('/space/Work')

    expect(workspace.active?.path).toBe('/space/Work/Work.md')
    expect(workspace.active?.doc).toBe('')
    expect(files.has('/space/Work/Work.md')).toBe(false)
    expect(sent.filter((one) => one.startsWith('write_note'))).toEqual([])
  })

  test('and the words written into that empty page are a note the list holds', async () => {
    await workspace.openRow('/space/Work')
    workspace.active?.note.live.replace('# Work\n\nwhat the folder is for')
    await workspace.writesSettled()

    expect(files.get('/space/Work/Work.md')).toBe('# Work\n\nwhat the folder is for')
    expect(workspace.notes.map((one) => one.path)).toContain('/space/Work/Work.md')
  })

  test('but a note in a folder the list leaves out leaves the list alone', async () => {
    await workspace.open('/space/.hidden/Notes.md', { blank: true })
    const listed = workspace.tree
    workspace.active?.note.live.replace('# Kept here')
    await workspace.writesSettled()

    expect(files.get('/space/.hidden/Notes.md')).toBe('# Kept here')
    expect(workspace.tree).toBe(listed)
  })

  test('and a row that is a note opens that note', async () => {
    await workspace.openRow('/space/Beta.md')
    expect(workspace.active?.path).toBe('/space/Beta.md')
  })

  test('and a note that is there and will not read opens nothing, and says so', async () => {
    locked.add('/space/Beta.md')

    await workspace.openRow('/space/Beta.md')
    expect(workspace.tabs).toEqual([])
    expect(unread.shown).toBe(true)
  })

  test('but one that has gone is simply not there, and says nothing', async () => {
    files.delete('/space/Beta.md')

    await workspace.openRow('/space/Beta.md')
    expect(workspace.tabs).toEqual([])
    expect(unread.shown).toBe(false)
  })

  test('and a folder note the list has not seen, which will not read, is never an empty page', async () => {
    locked.add('/space/Work/Work.md')

    await workspace.openRow('/space/Work')
    expect(workspace.tabs).toEqual([])
    expect(unread.shown).toBe(true)
    expect(sent.filter((one) => one.startsWith('write_note'))).toEqual([])
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

describe('opening a canvas whose file is not JSON', () => {
  test('opens nothing, says so, and leaves the file as it was', async () => {
    const words = '{"nodes":[{"id":"a","type":"text","text":"precious"}],"edges":[],}'
    files.set('/space/Board.canvas', words)

    await workspace.openCanvas('/space/Board.canvas')
    expect(workspace.tabs).toEqual([])
    expect(unread.shown).toBe(true)
    expect(files.get('/space/Board.canvas')).toBe(words)
  })

  test('but a file with nothing in it, or only blank lines, is a new plane', async () => {
    files.set('/space/Blank.canvas', ' \n')

    await workspace.openCanvas('/space/Blank.canvas')
    expect(workspace.active?.kind).toBe('canvas')
  })
})

describe('opening a page note whose file is not JSON', () => {
  test('opens nothing, says so, and leaves the file as it was', async () => {
    const words =
      '{"nodes":[{"id":"p","type":"file","file":"Lecture.pages.pdf","x":0,"y":0,"width":10,"height":10}],"edges":[],}'
    files.set('/space/Lecture.pages', words)

    await workspace.openPages('/space/Lecture.pages')
    expect(workspace.tabs).toEqual([])
    expect(unread.shown).toBe(true)
    expect(files.get('/space/Lecture.pages')).toBe(words)
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

  test('but only where there is a row to type in', () => {
    workspace.panel = 'search'
    workspace.startRenaming('/space/Beta.md')
    expect(workspace.naming).toBeNull()
  })

  test('while a space is named in the header, which any open panel has', () => {
    workspace.panel = 'search'
    workspace.startRenaming('/space')
    expect(workspace.naming?.path).toBe('/space')

    workspace.panel = null
    workspace.naming = null
    workspace.startRenaming('/space')
    expect(workspace.naming).toBeNull()
  })

  test('a page note renamed to a canvas is shown as the canvas it now is', async () => {
    const plane =
      '{"nodes":[{"id":"a","type":"text","text":"A card","x":0,"y":0,"width":200,"height":80}],"edges":[]}'
    files.set('/space/Deck.pages', plane)
    await workspace.loadTree()
    await workspace.openEntry('/space/Deck.pages')
    expect(workspace.active?.kind).toBe('pages')

    await workspace.rename('/space/Deck.pages', 'Deck.canvas')
    expect(workspace.active?.kind).toBe('canvas')
    expect(workspace.active?.path).toBe('/space/Deck.canvas')
    expect(workspace.active?.doc).toBe(plane)

    await workspace.openEntry('/space/Deck.canvas')
    expect(workspace.tabs.filter((one) => one.path === '/space/Deck.canvas')).toHaveLength(1)
    expect(workspace.active?.kind).toBe('canvas')

    await workspace.undoFileAction()
    expect(workspace.active?.path).toBe('/space/Deck.pages')
    expect(workspace.active?.kind).toBe('pages')
  })

  test('but a note renamed to a canvas keeps showing its words', async () => {
    await workspace.openEntry('/space/Beta.md')
    await workspace.rename('/space/Beta.md', 'Beta.canvas')

    expect(workspace.active?.kind).toBe('note')
    expect(workspace.active?.doc).toBe('# Beta')
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

describe('making a website', () => {
  test('writes the name once, ending and all', async () => {
    await workspace.createWebsite()
    expect(workspace.naming?.path).toBe('/space/Untitled.url')

    await workspace.makeNamed('Blog.url')

    expect([...files.keys()]).toContain('/space/Blog.url')
    expect([...files.keys()]).not.toContain('/space/Blog.url.url')
  })

  test('and the title inside it is the name, not the file name', async () => {
    await workspace.createWebsite()
    await workspace.makeNamed('Blog.url')

    expect(files.get('/space/Blog.url')).toContain('Blog')
    expect(files.get('/space/Blog.url')).not.toContain('Blog.url')
  })
})

describe('duplicating a file', () => {
  test('puts the word beside the name and keeps the ending', async () => {
    await workspace.duplicate('/space/Beta.md')

    expect(files.get('/space/Beta copy.md')).toBe('# Beta')
    expect([...files.keys()]).toContain('/space/Beta.md')
  })

  test('and a second copy is a second file rather than the first one over again', async () => {
    await workspace.duplicate('/space/Beta.md')
    await workspace.duplicate('/space/Beta.md')

    expect([...files.keys()].filter((one) => one.startsWith('/space/Beta copy'))).toEqual([
      '/space/Beta copy.md',
      '/space/Beta copy 2.md',
    ])
  })

  test('and a name that is only an ending copies to a name', async () => {
    files.set('/space/.md', '# only an ending')
    await workspace.loadTree()

    await workspace.duplicate('/space/.md')
    expect([...files.keys()]).toContain('/space/copy.md')
    expect([...files.keys()]).not.toContain('/space/ copy.md')
  })

  test('and a canvas copies as a canvas', async () => {
    files.set('/space/Board.canvas', '{}')
    await workspace.loadTree()

    await workspace.duplicate('/space/Board.canvas')
    expect([...files.keys()]).toContain('/space/Board copy.canvas')
  })
})

describe('copying rows', () => {
  test('keeps the name in another folder and says copy beside itself', async () => {
    await workspace.copyMany(['/space/Beta.md'], '/space/Work')
    await workspace.copyMany(['/space/Work/Plan.md'], '/space/Work')

    expect(files.get('/space/Work/Beta.md')).toBe('# Beta')
    expect(files.get('/space/Work/Plan copy.md')).toBe('# Plan')
    expect(files.get('/space/Beta.md')).toBe('# Beta')
  })

  test('picks what arrived, so the next key acts on it', async () => {
    await workspace.copyMany(['/space/Beta.md'], '/space/Work')
    expect(workspace.selection).toEqual(['/space/Work/Beta.md'])
  })

  test('and a folder drawn as its note is still one', async () => {
    folders.add('/space/Trip')
    files.set('/space/Trip/Trip.md', '# Trip')
    files.set('/space/Trip/Day one.md', '# Day one')
    await workspace.loadTree()

    await workspace.duplicate('/space/Trip')

    expect(files.get('/space/Trip copy/Trip copy.md')).toBe('# Trip')
    expect(files.get('/space/Trip copy/Day one.md')).toBe('# Day one')
    expect([...files.keys()]).not.toContain('/space/Trip copy/Trip.md')
  })

  test('never copies a folder into itself', async () => {
    await workspace.copyMany(['/space/Work'], '/space/Work')
    expect(sent.some((one) => one.startsWith('copy_path'))).toBe(false)
  })

  test('is one undo however many rows it took, and one redo back', async () => {
    await workspace.copyMany(['/space/Beta.md', '/space/Work/Plan.md'], '/space/Work')
    expect(workspace.undoLabel).toBe('Undo the copy')

    await workspace.undoFileAction()
    expect([...files.keys()]).not.toContain('/space/Work/Beta.md')
    expect([...files.keys()]).not.toContain('/space/Work/Plan copy.md')
    expect(workspace.canRedo).toBe(true)

    await workspace.redoFileAction()
    expect(files.get('/space/Work/Beta.md')).toBe('# Beta')
    expect(files.get('/space/Work/Plan copy.md')).toBe('# Plan')
    expect(workspace.canRedo).toBe(false)
  })
})

describe('doing a file operation again', () => {
  test('moves a move that was undone', async () => {
    await workspace.moveMany(['/space/Beta.md'], '/space/Work')
    await workspace.undoFileAction()
    expect(files.has('/space/Beta.md')).toBe(true)
    expect(workspace.canRedo).toBe(true)

    await workspace.redoFileAction()
    expect(files.has('/space/Work/Beta.md')).toBe(true)
    expect(workspace.undoLabel).toBe('Undo moving Beta')
  })

  test('and has nothing left to do once something new is done', async () => {
    await workspace.rename('/space/Beta.md', 'Gamma.md')
    await workspace.undoFileAction()
    expect(workspace.canRedo).toBe(true)

    await workspace.duplicate('/space/Beta.md')
    expect(workspace.canRedo).toBe(false)
  })
})

describe('files dropped from outside', () => {
  test('arrive in the folder, a folder with everything in it', async () => {
    await workspace.bringIn(
      [dropped('Trip/Trip.md', '# Trip'), dropped('Trip/map.png', 'PNG'), dropped('Beta.md', 'b')],
      '/space/Work',
    )

    expect(files.get('/space/Work/Trip/Trip.md')).toBe('# Trip')
    expect(files.get('/space/Work/Trip/map.png')).toBe('PNG')
    expect(sent).toContain('write_bytes /space/Work/Trip/map.png')
    expect(files.get('/space/Work/Beta.md')).toBe('b')
  })

  test('step aside from a name that is taken, and go again in one undo', async () => {
    await workspace.bringIn([dropped('Beta.md', 'new'), dropped('Trip/a.md', 'a')], '/space')

    expect(files.get('/space/Beta.md')).toBe('# Beta')
    expect(files.get('/space/Beta 2.md')).toBe('new')

    await workspace.undoFileAction()
    expect(files.has('/space/Beta 2.md')).toBe(false)
    expect(files.has('/space/Trip/a.md')).toBe(false)
    expect(files.get('/space/Beta.md')).toBe('# Beta')
  })
})

describe('a PDF opened with Orden', () => {
  const OUTSIDE = '/downloads/Paper.pdf'
  const writing = () => sent.filter((one) => /^(write|rename|copy|create|delete|trash)/.test(one))

  beforeEach(() => {
    outside.clear()
    outside.set(OUTSIDE, '%PDF paper')
    sheet.asked = []
    sheet.answer = null
    workspace.closed.stack = []
  })

  async function opened() {
    const { showPdfs } = await import('../../pdf/handed')
    await showPdfs([OUTSIDE])
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')
    return tab
  }

  function drawnOn(tab: { note: { text: string; replace(text: string): void } }) {
    const plane = JSON.parse(tab.note.text) as { nodes: Record<string, unknown>[] }
    plane.nodes.push({ id: 'ink', type: 'text', text: 'marked', x: 0, y: 0, width: 9, height: 9 })
    tab.note.replace(JSON.stringify(plane))
  }

  test('opens as a page note nobody has saved, and the space is left as it was', async () => {
    const was = [...files.entries()].sort()
    const listed = rows()

    const tab = await opened()

    expect(tab.kind).toBe('pages')
    expect(tab.path).toBeNull()
    expect(tab.shown).toBe('Paper')
    expect(isDraft(tab.note)).toBe(true)
    expect([...files.entries()].sort()).toEqual(was)
    expect(rows()).toEqual(listed)
    expect(writing()).toEqual([])
  })

  test('closes without a question while nothing on it has changed', async () => {
    const tab = await opened()

    await workspace.closeAsking(tab.id)

    expect(sheet.asked).toEqual([])
    expect(workspace.tabs.some((one) => one.id === tab.id)).toBe(false)
    expect(writing()).toEqual([])
  })

  test('asks before it closes once something is marked on it', async () => {
    const tab = await opened()
    drawnOn(tab)

    await workspace.closeAsking(tab.id)

    expect(sheet.asked).toEqual(['Save changes to Paper?'])
    expect(workspace.tabs.some((one) => one.id === tab.id)).toBe(true)
  })

  test('saved, it is a page note in the space holding the paper', async () => {
    const tab = await opened()
    drawnOn(tab)

    expect(await workspace.save(tab, '/space')).toBe('/space/Paper.pages')

    expect(files.get('/space/Paper.pages.pdf')).toBe('%PDF paper')
    expect(pagesIn('/space/Paper.pages').map((page) => page.file)).toEqual([
      'Paper.pages.pdf',
      'Paper.pages.pdf',
    ])
    expect(files.get('/space/Paper.pages')).toContain('marked')
    expect(rows()).toContain('/space/Paper.pages')
    expect(rows()).not.toContain('/space/Paper.pages.pdf')
    expect(outside.get(OUTSIDE)).toBe('%PDF paper')
  })

  test('opened again while it is open, it is the one tab', async () => {
    const first = await opened()
    const second = await opened()

    expect(second.id).toBe(first.id)
    expect(workspace.tabs.filter((one) => one.kind === 'pages')).toHaveLength(1)
  })

  test('is the copy the space has when it has one', async () => {
    files.set('/space/Work/Read.pdf', '%PDF paper')
    await workspace.loadTree()

    const tab = await opened()

    expect(tab.path).toBe('/space/Work/Read.pages')
    expect(files.has('/space/Paper.pages')).toBe(false)
  })

  test('and nothing at all when it could not be read', async () => {
    outside.set(OUTSIDE, 'not a paper')

    const { showPdfs } = await import('../../pdf/handed')
    await showPdfs([OUTSIDE])

    expect(workspace.tabs).toEqual([])
  })
})

function pagesIn(path: string): { file: string | undefined; subpath: string | undefined }[] {
  const nodes = (JSON.parse(files.get(path) ?? '{}') as { nodes?: Record<string, unknown>[] }).nodes
  return (nodes ?? [])
    .filter((node) => node.type === 'file')
    .map((node) => ({
      file: typeof node.file === 'string' ? node.file : undefined,
      subpath: typeof node.subpath === 'string' ? node.subpath : undefined,
    }))
}

const BESIDE = JSON.stringify({
  nodes: [
    {
      id: 'p1',
      type: 'file',
      file: 'Lecture.pdf',
      subpath: '#page=1',
      x: -397,
      y: 0,
      width: 794,
      height: 1123,
    },
  ],
  edges: [],
  orden: {
    version: 1,
    pages: [{ id: 'p1', paper: 'a4', pattern: 'blank' }],
    ink: [{ id: 'k1', tool: 'fountain', color: '1', size: 2, points: [0, 10, 0.5, 40, 60, 0.5] }],
  },
})

describe('a PDF becomes the page note that holds it', () => {
  test('dropped on the list on its own, it lands as its page note', async () => {
    await workspace.bringIn([dropped('Lecture 4.pdf', '%PDF lecture')], '/space/Work')

    expect(rows()).toContain('/space/Work/Lecture 4.pages')
    expect(rows()).not.toContain('/space/Work/Lecture 4.pdf')
    expect(rows()).not.toContain('/space/Work/Lecture 4.pages.pdf')
    expect(files.get('/space/Work/Lecture 4.pages.pdf')).toBe('%PDF lecture')
    expect(files.has('/space/Work/Lecture 4.pdf')).toBe(false)
    expect(pagesIn('/space/Work/Lecture 4.pages')).toEqual([
      { file: 'Lecture 4.pages.pdf', subpath: '#page=1' },
      { file: 'Lecture 4.pages.pdf', subpath: '#page=2' },
    ])

    await workspace.undoFileAction()
    expect(files.has('/space/Work/Lecture 4.pages')).toBe(false)
    expect(files.has('/space/Work/Lecture 4.pages.pdf')).toBe(false)
  })

  test("but one inside a dropped folder is that folder's, and stays a PDF", async () => {
    await workspace.bringIn(
      [dropped('Course/Notes.md', '![[Reading.pdf]]'), dropped('Course/Reading.pdf', '%PDF')],
      '/space',
    )

    expect(rows()).toContain('/space/Course/Reading.pdf')
    expect(files.has('/space/Course/Reading.pages')).toBe(false)
  })

  test('one already in the space becomes its page note the first time it opens', async () => {
    files.set('/space/Work/Paper.pdf', '%PDF paper')
    await workspace.loadTree()

    await workspace.openEntry('/space/Work/Paper.pdf')

    expect(workspace.active?.path).toBe('/space/Work/Paper.pages')
    expect(workspace.active?.kind).toBe('pages')
    expect(rows()).toContain('/space/Work/Paper.pages')
    expect(rows()).not.toContain('/space/Work/Paper.pdf')
    expect(files.has('/space/Work/Paper.pdf')).toBe(false)
    expect(files.get('/space/Work/Paper.pages.pdf')).toBe('%PDF paper')
  })

  test('and its paper, asked for again, is that page note', async () => {
    files.set('/space/Paper.pages', BESIDE.replaceAll('Lecture.pdf', 'Paper.pages.pdf'))
    files.set('/space/Paper.pages.pdf', '%PDF paper')
    await workspace.loadTree()

    await workspace.openPdf('/space/Paper.pages.pdf')
    expect(workspace.active?.path).toBe('/space/Paper.pages')
    expect(rows()).toEqual([
      '/space/Work',
      '/space/Work/Plan.md',
      '/space/Beta.md',
      '/space/Paper.pages',
    ])
  })

  test('a page note an older build made beside its PDF takes the PDF in, ink and all', async () => {
    files.set('/space/Lecture.pdf', '%PDF lecture')
    files.set('/space/Lecture.pages', BESIDE)
    await workspace.loadTree()

    await workspace.openEntry('/space/Lecture.pdf')

    expect(workspace.active?.path).toBe('/space/Lecture.pages')
    expect(rows()).not.toContain('/space/Lecture.pdf')
    expect(files.get('/space/Lecture.pages.pdf')).toBe('%PDF lecture')
    expect(files.get('/space/Lecture.pages')).toBe(BESIDE)
  })

  test('the same when it is the page note that is opened', async () => {
    files.set('/space/Lecture.pdf', '%PDF lecture')
    files.set('/space/Lecture.pages', BESIDE)
    await workspace.loadTree()

    await workspace.openEntry('/space/Lecture.pages')

    expect(rows()).not.toContain('/space/Lecture.pdf')
    expect(files.get('/space/Lecture.pages.pdf')).toBe('%PDF lecture')
    expect(files.get('/space/Lecture.pages')).toBe(BESIDE)
  })

  test("somebody's own page note of that name is left alone, and the PDF steps aside", async () => {
    const own = BESIDE.replaceAll('Lecture.pdf', 'Other.pdf')
    files.set('/space/Lecture.pdf', '%PDF lecture')
    files.set('/space/Lecture.pages', own)
    await workspace.loadTree()

    await workspace.openEntry('/space/Lecture.pdf')

    expect(workspace.active?.path).toBe('/space/Lecture 2.pages')
    expect(files.get('/space/Lecture.pages')).toBe(own)
    expect(files.get('/space/Lecture 2.pages.pdf')).toBe('%PDF lecture')
    expect(files.has('/space/Lecture.pdf')).toBe(false)
  })

  test('a file that is not a PDF is left as it is', async () => {
    files.set('/space/Broken.pdf', 'not a pdf')
    await workspace.loadTree()

    await workspace.openEntry('/space/Broken.pdf')

    expect(files.get('/space/Broken.pdf')).toBe('not a pdf')
    expect(files.has('/space/Broken.pages')).toBe(false)
    expect(rows()).toContain('/space/Broken.pdf')
  })

  test('and opens nothing, which it says', async () => {
    files.set('/space/Broken.pdf', 'not a pdf')

    await workspace.openPdf('/space/Broken.pdf')
    expect(workspace.tabs).toEqual([])
    expect(unread.shown).toBe(true)
  })

  test('a page note renamed takes its paper with it', async () => {
    await workspace.bringIn([dropped('Week 1.pdf', '%PDF week')], '/space')
    await workspace.rename('/space/Week 1.pages', 'Optics.pages')

    expect(files.has('/space/Week 1.pages.pdf')).toBe(false)
    expect(files.get('/space/Optics.pages.pdf')).toBe('%PDF week')
    expect(rows()).toContain('/space/Optics.pages')
    expect(rows()).not.toContain('/space/Optics.pages.pdf')
  })
})

describe('a name two kinds share', () => {
  beforeEach(async () => {
    files.set('/space/Note.md', '# Note')
    files.set('/space/Note.canvas', '{}')
    await workspace.loadTree()
  })

  test('is two files, and renaming one leaves the other alone', async () => {
    await workspace.rename('/space/Note.canvas', 'Board.canvas')

    expect([...files.keys()]).toContain('/space/Board.canvas')
    expect(files.get('/space/Note.md')).toBe('# Note')
  })

  test('and the field knows which of the two a name would take', () => {
    const beside = workspace.namesBeside('/space/Note.canvas')
    expect(nameFault({ typed: 'Note', extension: '.canvas', taken: beside })).toBeNull()
    expect(nameFault({ typed: 'Note', extension: '.md', taken: beside })).toBe('taken')
  })
})

describe('the undo the palette offers', () => {
  test('names the file the way the row names it', async () => {
    files.set('/space/Sketch.pages', '{}')
    await workspace.loadTree()

    await workspace.rename('/space/Sketch.pages', 'Sketch drawing.pages')
    expect(workspace.undoLabel).toBe('Undo renaming Sketch drawing')

    await workspace.move('/space/Beta.md', '/space/Work')
    expect(workspace.undoLabel).toBe('Undo moving Beta')
  })
})

describe('what the account is told about a file that moved', () => {
  afterEach(() => vi.restoreAllMocks())

  test('a rename is that note, under another name', async () => {
    const moved = vi.spyOn(sync, 'moved').mockResolvedValue(undefined)

    await workspace.rename('/space/Beta.md', 'Gamma.md')

    expect(moved).toHaveBeenCalledWith('/space/Beta.md', '/space/Gamma.md')
  })

  test('and a drag into a folder is the same note, in the folder', async () => {
    const moved = vi.spyOn(sync, 'moved').mockResolvedValue(undefined)

    await workspace.move('/space/Beta.md', '/space/Work')

    expect(moved).toHaveBeenCalledWith('/space/Beta.md', '/space/Work/Beta.md')
  })

  test('while a rename the disk refused says nothing at all', async () => {
    files.set('/space/Taken.md', '# Taken')
    await workspace.loadTree()
    const moved = vi.spyOn(sync, 'moved').mockResolvedValue(undefined)

    await expect(workspace.rename('/space/Beta.md', 'Taken.md')).rejects.toThrow()

    expect(moved).not.toHaveBeenCalled()
  })
})

describe('a rename the disk refuses', () => {
  test('leaves the row under the name it has', async () => {
    files.set('/space/Taken.md', '# Taken')
    await workspace.loadTree()

    await expect(workspace.rename('/space/Beta.md', 'Taken.md')).rejects.toThrow()

    expect(rows()).toContain('/space/Beta.md')
    expect(rows()).not.toContain('/space/Taken 2.md')
    expect(files.get('/space/Beta.md')).toBe('# Beta')
  })

  test('and so does a move', async () => {
    files.set('/space/Work/Beta.md', '# another Beta')
    await workspace.loadTree()

    await expect(workspace.move('/space/Beta.md', '/space/Work')).rejects.toThrow()

    expect(rows()).toContain('/space/Beta.md')
    expect(files.get('/space/Work/Beta.md')).toBe('# another Beta')
  })
})

describe('signed in', () => {
  beforeEach(() => {
    Object.defineProperty(account, 'signedIn', { get: () => true, configurable: true })
    account.spaces = [{ id: 'remote', role: 'owner' } as RemoteSpace]
  })

  afterEach(() => {
    Reflect.deleteProperty(account, 'signedIn')
    account.spaces = []
    vi.restoreAllMocks()
  })

  test('a folder copy undone goes to the trash with what was typed in it', async () => {
    vi.spyOn(sync, 'remoteIdFor').mockReturnValue('remote')
    folders.add('/space/Trip')
    files.set('/space/Trip/Plan.md', '# Plan')
    await workspace.loadTree()
    await workspace.duplicate('/space/Trip')
    files.set('/space/Trip copy/Plan.md', '# Plan\ntyped into the copy')
    sent.length = 0

    await workspace.undoFileAction()

    expect(sent).toContain('trash_item /space/Trip copy')
    expect(sent).not.toContain('delete_folder /space/Trip copy')
  })

  test('and a picture dropped in and taken back goes there too', async () => {
    vi.spyOn(sync, 'remoteIdFor').mockReturnValue('remote')
    await workspace.bringIn([dropped('map.png', 'PNG')], '/space')
    sent.length = 0

    await workspace.undoFileAction()

    expect(sent).toContain('trash_item /space/map.png')
    expect(sent).not.toContain('delete_note /space/map.png')
  })

  test('and a paper an import wrote, highlighted since, goes there too', async () => {
    vi.spyOn(sync, 'remoteIdFor').mockReturnValue('remote')
    files.set('/space/paper.pdf', '%PDF highlighted')
    workspace.undone.record({ kind: 'import', paths: ['/space/paper.pdf'], wrote: {} })

    await workspace.undoFileAction()

    expect(sent).toContain('trash_item /space/paper.pdf')
    expect(sent).not.toContain('delete_note /space/paper.pdf')
  })

  test('a folder deleted in a space on no account goes to the trash', async () => {
    await workspace.remove('/space/Work', true)

    expect(sent).toContain('trash_item /space/Work')
    expect(sent).not.toContain('delete_folder /space/Work')
  })

  test('but one in a space on the account goes to the account', async () => {
    vi.spyOn(sync, 'remoteIdFor').mockReturnValue('remote')
    vi.spyOn(sync, 'holds').mockResolvedValue(true)

    await workspace.remove('/space/Work', true)

    expect(sent).toContain('delete_folder /space/Work')
  })

  test('a folder holding a dotfile goes to the trash', async () => {
    vi.spyOn(sync, 'remoteIdFor').mockReturnValue('remote')
    vi.spyOn(sync, 'holds').mockResolvedValue(true)
    folders.add('/space/Project')
    files.set('/space/Project/a.md', '# a')
    files.set('/space/Project/.hidden.md', '# hidden')
    await workspace.loadTree()
    sent.length = 0

    await workspace.remove('/space/Project', true)

    expect(sent).toContain('trash_item /space/Project')
    expect(sent).not.toContain('delete_folder /space/Project')
  })

  test('a paper the account was never handed goes to the trash', async () => {
    vi.spyOn(sync, 'remoteIdFor').mockReturnValue('remote')
    files.set('/space/paper.pdf', '%PDF')
    await workspace.loadTree()
    sent.length = 0

    await workspace.remove('/space/paper.pdf', false)

    expect(sent).toContain('trash_item /space/paper.pdf')
    expect(sent).not.toContain('delete_note /space/paper.pdf')
  })

  test('and so does a folder holding one', async () => {
    vi.spyOn(sync, 'remoteIdFor').mockReturnValue('remote')
    vi.spyOn(sync, 'holds').mockImplementation((path) => Promise.resolve(path.endsWith('.md')))
    files.set('/space/Work/paper.pdf', '%PDF')
    await workspace.loadTree()
    sent.length = 0

    await workspace.remove('/space/Work', true)

    expect(sent).toContain('trash_item /space/Work')
    expect(sent).not.toContain('delete_folder /space/Work')
  })
})
