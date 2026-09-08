import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AssetRow, FileRow, SnapshotRow } from './store'

/** The browser's stand-in for the file commands, driven against a disk that
 *  lives in a Map rather than in IndexedDB. Node has no IndexedDB, and the
 *  point of these is the path arithmetic and the trash bookkeeping - not the
 *  database underneath, which `store.ts` is the only thing that touches. */

const disk = vi.hoisted(() => {
  const files = new Map<string, FileRow>()
  const assets = new Map<string, AssetRow>()
  const meta = new Map<string, string>()
  const snapshots: SnapshotRow[] = []

  return { files, assets, meta, snapshots }
})

vi.mock('./store', () => ({
  KEEP: '.keep',
  files: {
    get: (path: string) => Promise.resolve(disk.files.get(path)),
    all: () => Promise.resolve([...disk.files.values()]),
    put: (row: FileRow) => Promise.resolve(void disk.files.set(row.path, row)),
    remove: (path: string) => Promise.resolve(void disk.files.delete(path)),
    // The real one is a single transaction; here it is a single statement,
    // which is the same promise from the caller's side.
    move: (rows: FileRow[], gone: string[]) => {
      for (const row of rows) disk.files.set(row.path, row)
      for (const path of gone) {
        if (!rows.some((row) => row.path === path)) disk.files.delete(path)
      }
      return Promise.resolve()
    },
  },
  assets: {
    get: (path: string) => Promise.resolve(disk.assets.get(path)),
    all: () => Promise.resolve([...disk.assets.values()]),
    put: (row: AssetRow) => Promise.resolve(void disk.assets.set(row.path, row)),
    remove: (path: string) => Promise.resolve(void disk.assets.delete(path)),
  },
  meta: {
    get: (key: string) => Promise.resolve(disk.meta.get(key)),
    put: (key: string, value: string) => Promise.resolve(void disk.meta.set(key, value)),
    remove: (key: string) => Promise.resolve(void disk.meta.delete(key)),
    keys: () => Promise.resolve([...disk.meta.keys()].sort()),
  },
  snapshots: {
    put: (row: SnapshotRow) => Promise.resolve(void disk.snapshots.push(row)),
    remove: (id: number) => Promise.resolve(void disk.snapshots.splice(id, 1)),
    forNote: (notePath: string) =>
      Promise.resolve(disk.snapshots.filter((one) => one.notePath === notePath)),
  },
}))

const { webInvoke } = await import('./commands')

const write = (path: string, content = '') => webInvoke('write_note', { path, content })
const read = (path: string) => webInvoke<string>('read_note', { path })
const paths = () => [...disk.files.keys()].sort()

beforeEach(() => {
  disk.files.clear()
  disk.assets.clear()
  disk.meta.clear()
  disk.snapshots.length = 0
})

describe('notes', () => {
  test('are written, read back and deleted', async () => {
    await write('/Notes/Idea.md', '# Idea')
    expect(await read('/Notes/Idea.md')).toBe('# Idea')

    await webInvoke('delete_note', { path: '/Notes/Idea.md' })
    await expect(read('/Notes/Idea.md')).rejects.toThrow()
  })

  test('keep the moment they were made across a rewrite', async () => {
    await write('/Notes/Idea.md', 'one')
    const made = disk.files.get('/Notes/Idea.md')?.created

    await write('/Notes/Idea.md', 'two')
    expect(disk.files.get('/Notes/Idea.md')?.created).toBe(made)
  })
})

describe('renaming', () => {
  test('takes everything under a folder along', async () => {
    await write('/Notes/Work/a.md', 'a')
    await write('/Notes/Work/deep/b.md', 'b')

    await webInvoke('rename_note', { from: '/Notes/Work', to: '/Notes/Done' })

    expect(paths()).toEqual(['/Notes/Done/a.md', '/Notes/Done/deep/b.md'])
    expect(await read('/Notes/Done/deep/b.md')).toBe('b')
  })

  test('refuses a name a note already has', async () => {
    await write('/Notes/a.md', 'a')
    await write('/Notes/b.md', 'b')

    await expect(
      webInvoke('rename_note', { from: '/Notes/a.md', to: '/Notes/b.md' }),
    ).rejects.toThrow()
    expect(await read('/Notes/b.md')).toBe('b')
  })

  /** A folder has no row of its own - it exists because something is in it -
   *  so asking about the exact path finds nothing and the rename went ahead,
   *  putting the note inside the folder under the folder's own name. */
  test('refuses a name a folder already has', async () => {
    await write('/Notes/a.md', 'a')
    await write('/Notes/Work/b.md', 'b')

    await expect(
      webInvoke('rename_note', { from: '/Notes/a.md', to: '/Notes/Work' }),
    ).rejects.toThrow()

    expect(paths()).toEqual(['/Notes/Work/b.md', '/Notes/a.md'])
  })

  test('refuses to rename something that is not there', async () => {
    await expect(
      webInvoke('rename_note', { from: '/Notes/gone.md', to: '/Notes/here.md' }),
    ).rejects.toThrow()
  })
})

describe('spaces', () => {
  test('are the folders under the root, in order, dot folders left out', async () => {
    await write('/Work/a.md')
    await write('/Notes/b.md')
    await write('/.trash/1/c.md')

    expect(await webInvoke('list_spaces')).toEqual([
      { name: 'Notes', path: '/Notes' },
      { name: 'Work', path: '/Work' },
    ])
  })

  test('step their name rather than joining an existing one', async () => {
    expect(await webInvoke('create_space', { name: 'Notes' })).toEqual({
      name: 'Notes',
      path: '/Notes',
    })
    expect(await webInvoke('create_space', { name: 'Notes' })).toEqual({
      name: 'Notes 2',
      path: '/Notes 2',
    })
  })
})

describe('the trash', () => {
  test('holds what was deleted and puts it back where it came from', async () => {
    await write('/Notes/Idea.md', '# Idea')

    const entry = await webInvoke<{ id: string }>('trash_item', {
      path: '/Notes/Idea.md',
      kind: 'note',
    })

    expect(paths()).toEqual([`/.trash/${entry.id}/Idea.md`])
    expect(await webInvoke('list_trash')).toMatchObject([{ kind: 'note', name: 'Idea.md' }])

    expect(await webInvoke('restore_trash', { id: entry.id })).toBe('/Notes/Idea.md')
    expect(await read('/Notes/Idea.md')).toBe('# Idea')
    expect(await webInvoke('list_trash')).toEqual([])
  })

  test('puts a note back beside the one that took its place', async () => {
    await write('/Notes/Idea.md', 'first')
    const entry = await webInvoke<{ id: string }>('trash_item', {
      path: '/Notes/Idea.md',
      kind: 'note',
    })

    await write('/Notes/Idea.md', 'second')

    expect(await webInvoke('restore_trash', { id: entry.id })).toBe('/Notes/Idea 2.md')
    expect(await read('/Notes/Idea.md')).toBe('second')
    expect(await read('/Notes/Idea 2.md')).toBe('first')
  })

  test('says so when what it held is already gone', async () => {
    await write('/Notes/Idea.md', '# Idea')
    const entry = await webInvoke<{ id: string }>('trash_item', {
      path: '/Notes/Idea.md',
      kind: 'note',
    })

    await webInvoke('purge_trash', { id: entry.id })
    await expect(webInvoke('restore_trash', { id: entry.id })).rejects.toThrow()
  })

  test('refuses to delete the root, or itself', async () => {
    await expect(webInvoke('trash_item', { path: '/', kind: 'space' })).rejects.toThrow()
    await expect(webInvoke('trash_item', { path: '/.trash', kind: 'space' })).rejects.toThrow()
  })

  test('reads a manifest nothing can be made of as an empty one', async () => {
    // The manifest is a string in the browser's own storage, written by some
    // version of this app and possibly by one interrupted halfway. Read as the
    // shape the code wants, a truncated entry is a crash on the way to Recently
    // deleted - and Recently deleted is where somebody goes to get a note back.
    for (const held of ['', 'not json', '{"id":"1"}', '42', 'null']) {
      disk.meta.set('trash', held)
      expect(await webInvoke('list_trash'), held).toEqual([])
    }

    // An entry that is not describable goes; the ones around it stay.
    disk.meta.set(
      'trash',
      JSON.stringify([
        { id: '1', kind: 'note', name: 'a.md', from: '/Notes/a.md', trashedAt: 1 },
        null,
        { id: '2', name: 'b.md' },
        { id: '3', kind: 'note', name: 'c.md', from: '/Notes/c.md', trashedAt: '3' },
      ]),
    )

    expect(await webInvoke<{ id: string }[]>('list_trash')).toEqual([
      { id: '1', kind: 'note', name: 'a.md', from: '/Notes/a.md', trashedAt: 1 },
    ])
  })

  test('writing to a manifest nothing can be made of does not lose the note', async () => {
    disk.meta.set('trash', 'not json')
    await write('/Notes/Idea.md', '# Idea')

    const entry = await webInvoke<{ id: string }>('trash_item', {
      path: '/Notes/Idea.md',
      kind: 'note',
    })

    expect(await webInvoke('list_trash')).toMatchObject([{ id: entry.id, name: 'Idea.md' }])
    expect(await webInvoke('restore_trash', { id: entry.id })).toBe('/Notes/Idea.md')
  })
})

describe('the tree', () => {
  test('holds folders before notes, and each sorted by name', async () => {
    await write('/Notes/b.md')
    await write('/Notes/a.md')
    await write('/Notes/Work/c.md')

    const tree = await webInvoke<{ children: { name: string; is_dir: boolean }[] }>('read_tree', {
      root: '/Notes',
    })

    expect(tree.children.map((one) => one.name)).toEqual(['Work', 'a.md', 'b.md'])
  })

  test('keeps an empty folder alive through its marker, and shows no marker', async () => {
    await webInvoke('create_folder', { path: '/Notes/Empty' })

    const tree = await webInvoke<{ children: { name: string; children: unknown[] }[] }>(
      'read_tree',
      { root: '/Notes' },
    )

    expect(tree.children.map((one) => one.name)).toEqual(['Empty'])
    expect(tree.children[0]?.children).toEqual([])
  })

  test('leaves out hidden notes unless asked for them', async () => {
    await write('/Notes/.private.md')
    await write('/Notes/a.md')

    const shown = await webInvoke<{ children: { name: string }[] }>('read_tree', { root: '/Notes' })
    expect(shown.children.map((one) => one.name)).toEqual(['a.md'])

    const all = await webInvoke<{ children: { name: string }[] }>('read_tree', {
      root: '/Notes',
      options: { showHidden: true },
    })
    expect(all.children.map((one) => one.name)).toEqual(['.private.md', 'a.md'])
  })

  test('lists the PDFs beside the notes, and nothing else', async () => {
    await write('/Notes/a.md')
    disk.assets.set('/Notes/paper.pdf', {
      path: '/Notes/paper.pdf',
      type: 'application/pdf',
      data: '',
      modified: 1,
    })
    disk.assets.set('/Notes/shot.png', {
      path: '/Notes/shot.png',
      type: 'image/png',
      data: '',
      modified: 1,
    })
    await write('/Notes/paper.pdf.highlights.json', '{}')

    const tree = await webInvoke<{ children: { name: string }[] }>('read_tree', { root: '/Notes' })
    expect(tree.children.map((one) => one.name)).toEqual(['a.md', 'paper.pdf'])
  })
})

describe("a PDF's highlights", () => {
  const pdf = '/Notes/paper.pdf'
  const sidecar = '/Notes/paper.pdf.highlights.json'

  test('are written beside it and read back', async () => {
    await webInvoke('write_highlights', { path: pdf, content: '{"version":1}' })
    expect(disk.files.get(sidecar)?.content).toBe('{"version":1}')
    expect(await webInvoke<string>('read_highlights', { path: pdf })).toBe('{"version":1}')
  })

  test('read as nothing for a PDF nobody has marked', async () => {
    expect(await webInvoke<string>('read_highlights', { path: pdf })).toBe('')
  })

  test('take the file with them once the last one is gone', async () => {
    await webInvoke('write_highlights', { path: pdf, content: '{"version":1}' })
    await webInvoke('write_highlights', { path: pdf, content: '' })

    expect(disk.files.has(sidecar)).toBe(false)
  })

  test('follow the PDF when it moves, since a folder rename takes both stores', async () => {
    disk.assets.set(pdf, { path: pdf, type: 'application/pdf', data: '', modified: 1 })
    await webInvoke('write_highlights', { path: pdf, content: '{"version":1}' })

    await webInvoke('rename_note', { from: '/Notes', to: '/Reading' })

    expect(disk.assets.has('/Reading/paper.pdf')).toBe(true)
    expect(disk.files.has('/Reading/paper.pdf.highlights.json')).toBe(true)
  })

  test('go when the PDF goes', async () => {
    disk.assets.set(pdf, { path: pdf, type: 'application/pdf', data: '', modified: 1 })
    await webInvoke('write_highlights', { path: pdf, content: '{"version":1}' })

    await webInvoke('delete_note', { path: pdf })

    expect(disk.assets.has(pdf)).toBe(false)
    expect(disk.files.has(sidecar)).toBe(false)
  })

  test('belong to a PDF and to nothing else', async () => {
    await expect(webInvoke('read_highlights', { path: '/Notes/Idea.md' })).rejects.toThrow()
    await expect(
      webInvoke('write_highlights', { path: '/Notes/Idea.md', content: '{}' }),
    ).rejects.toThrow()
  })
})

describe('a pasted picture', () => {
  const save = (notePath: string, folder: string) =>
    webInvoke<string>('save_asset', { notePath, folder, name: 'pic.png', bytes: [1, 2, 3] })

  test('goes in the folder the window asked for and is named relative to the note', async () => {
    expect(await save('/Notes/Read me.md', 'assets')).toBe('assets/pic.png')
    expect([...disk.assets.keys()]).toEqual(['/Notes/assets/pic.png'])
  })

  test('lands beside the note when no folder is named', async () => {
    expect(await save('/Notes/Read me.md', '')).toBe('pic.png')
    expect([...disk.assets.keys()]).toEqual(['/Notes/pic.png'])
  })

  test('climbs to the space’s own assets folder from a note further down', async () => {
    expect(await save('/Notes/Work/Plan.md', '../assets')).toBe('../assets/pic.png')
    expect([...disk.assets.keys()]).toEqual(['/Notes/assets/pic.png'])
  })

  test('goes in a folder named after the note', async () => {
    expect(await save('/Notes/Read me.md', 'Read me')).toBe('Read me/pic.png')
    expect([...disk.assets.keys()]).toEqual(['/Notes/Read me/pic.png'])
  })

  test('refuses a folder that climbs out of the space', async () => {
    await expect(save('/Notes/Read me.md', '../../elsewhere')).rejects.toThrow()
    await expect(save('/Notes/Work/Plan.md', '../../Other/assets')).rejects.toThrow()
    expect([...disk.assets.keys()]).toEqual([])
  })

  test('keeps the folder an older build wrote when none is sent', async () => {
    const written = await webInvoke<string>('save_asset', {
      notePath: '/Notes/Read me.md',
      name: 'pic.png',
      bytes: [1],
    })

    expect(written).toBe('assets/pic.png')
  })
})

/** The store installs a theme by writing a file into a folder. In a browser the
 *  folder is a prefix in storage, which is what makes the gallery work in the web
 *  build as well as on a desktop. */
describe('installed themes', () => {
  test('an empty store holds none', async () => {
    expect(await webInvoke('list_themes')).toEqual([])
  })

  test('a written theme is listed, read back, and taken away again', async () => {
    const path = await webInvoke<string>('write_theme', {
      id: 'warm-paper',
      css: '/*! nib-theme */',
    })

    expect(await webInvoke('list_themes')).toEqual([
      { id: 'file:warm-paper', name: 'Warm paper', path },
    ])
    expect(await webInvoke('read_theme', { path })).toBe('/*! nib-theme */')

    await webInvoke('remove_theme', { id: 'warm-paper' })
    expect(await webInvoke('list_themes')).toEqual([])
  })

  test('a second write replaces the first, as a file would', async () => {
    await webInvoke('write_theme', { id: 'mono', css: 'one' })
    await webInvoke('write_theme', { id: 'mono', css: 'two' })

    expect(await webInvoke('list_themes')).toHaveLength(1)
    expect(await webInvoke('read_theme', { path: 'themes/mono.css' })).toBe('two')
  })

  test('an id that is not one never becomes a key', async () => {
    for (const id of ['../custom', 'Mono', 'a b', '']) {
      await expect(webInvoke('write_theme', { id, css: 'x' })).rejects.toThrow()
    }

    expect(await webInvoke('list_themes')).toEqual([])
  })

  test('a theme that is not there reads as nothing rather than throwing', async () => {
    expect(await webInvoke('read_theme', { path: 'themes/nothing.css' })).toBe('')
  })
})

describe('what the browser cannot do', () => {
  test('answers the shape that makes the app hide the feature', async () => {
    expect(await webInvoke('has_pandoc')).toBe(false)
    expect(await webInvoke('take_startup_files')).toEqual([])
    expect(await webInvoke('theme_dir')).toBe('')
  })

  test('says so outright for a command nobody has stood in for', async () => {
    await expect(webInvoke('open_the_pod_bay_doors')).rejects.toThrow()
  })
})
