import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AssetRow, FileRow, SnapshotRow } from './store'
import type { Opener } from '../openers'
import type { SpaceLinks } from '@orden/scan/note'

const disk = vi.hoisted(() => {
  const files = new Map<string, FileRow>()
  const assets = new Map<string, AssetRow>()
  const meta = new Map<string, string>()
  const snapshots: SnapshotRow[] = []
  const reads: FileRow[][] = []
  const sized = { yes: true }
  const learnt = new Map<string, number>()
  const planes = new Map<string, unknown>()

  return { files, assets, meta, snapshots, reads, sized, learnt, planes }
})

vi.mock('./store', () => ({
  KEEP: '.keep',
  treeAt: () => null,
  trees: () => [],
  keepsOwnRows: () => true,
  files: {
    get: (path: string) => Promise.resolve(disk.files.get(path)),
    all: () => Promise.resolve([...disk.files.values()]),
    paths: () => Promise.resolve([...disk.files.keys()].sort()),
    each: (visit: (row: FileRow) => void) => {
      for (const path of [...disk.files.keys()].sort()) visit(disk.files.get(path)!)
      return Promise.resolve()
    },
    between: (from: string, to: string) => {
      const rows = [...disk.files.keys()]
        .sort()
        .filter((path) => path >= from && path <= to)
        .map((path) => disk.files.get(path)!)
      disk.reads.push(rows)
      return Promise.resolve(rows)
    },
    put: (row: FileRow) => Promise.resolve(void disk.files.set(row.path, row)),
    write: (path: string, content: string, at: number, plane?: unknown) => {
      const created = disk.files.get(path)?.created ?? at
      if (plane) disk.planes.set(path, plane)
      else disk.planes.delete(path)
      return Promise.resolve(void disk.files.set(path, { path, content, created, modified: at }))
    },
    remove: (path: string) => Promise.resolve(void disk.files.delete(path)),
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
    paths: () => Promise.resolve([...disk.assets.keys()].sort()),
    put: (row: AssetRow) => Promise.resolve(void disk.assets.set(row.path, row)),
    remove: (path: string) => Promise.resolve(void disk.assets.delete(path)),
  },
  stats: {
    holds: (path: string) =>
      Promise.resolve(
        [...disk.files.keys(), ...disk.assets.keys()].some(
          (one) => one === path || one.startsWith(`${path}/`),
        ),
      ),
    all: () =>
      Promise.resolve([
        ...[...disk.files.values()].map((row) => {
          const size = disk.sized.yes ? row.content.length : disk.learnt.get(row.path)
          const plane = disk.planes.get(row.path)
          return {
            path: row.path,
            modified: row.modified,
            created: row.created,
            ...(size === undefined ? {} : { size }),
            ...(plane ? { plane } : {}),
          }
        }),
        ...[...disk.assets.values()].map((row) => ({
          path: row.path,
          modified: row.modified,
          created: row.modified,
          ...(disk.sized.yes ? { size: row.data.length } : {}),
        })),
      ]),
    learn: (found: { path: string; size: number; plane?: unknown }[]) => {
      for (const one of found) {
        disk.learnt.set(one.path, one.size)
        if (one.plane) disk.planes.set(one.path, one.plane)
      }
      return Promise.resolve()
    },
  },
  meta: {
    get: (key: string) => Promise.resolve(disk.meta.get(key)),
    put: (key: string, value: string) => Promise.resolve(void disk.meta.set(key, value)),
    remove: (key: string) => Promise.resolve(void disk.meta.delete(key)),
    keys: () => Promise.resolve([...disk.meta.keys()].sort()),
  },
  snapshots: {
    put: (row: SnapshotRow) => {
      const at = disk.snapshots.findIndex((one) => row.id !== undefined && one.id === row.id)
      if (at >= 0) disk.snapshots[at] = row
      else disk.snapshots.push({ ...row, id: (disk.snapshots.at(-1)?.id ?? 0) + 1 })
      return Promise.resolve()
    },
    get: (id: number) => Promise.resolve(disk.snapshots.find((one) => one.id === id)),
    newest: (notePath: string) =>
      Promise.resolve(disk.snapshots.filter((one) => one.notePath === notePath).at(-1)),
    idsOf: (notePath: string) =>
      Promise.resolve(
        disk.snapshots.filter((one) => one.notePath === notePath).map((one) => one.id ?? 0),
      ),
    remove: (id: number) => {
      const at = disk.snapshots.findIndex((one) => one.id === id)
      if (at >= 0) disk.snapshots.splice(at, 1)
      return Promise.resolve()
    },
    forNote: (notePath: string) =>
      Promise.resolve(disk.snapshots.filter((one) => one.notePath === notePath)),
  },
}))

function memoryStorage(): Storage {
  const held = new Map<string, string>()

  return {
    get length() {
      return held.size
    },
    key: (at) => [...held.keys()][at] ?? null,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    clear: () => held.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const { MOST_NOTE_BYTES, SCANNED_AT_ONCE, TOO_LARGE, seed, webInvoke } = await import('./commands')
const { stamped, stampOf } = await import('../themes/stamp')
const { forgetSeedStore, rememberSeedIn, seedSpaceRoot } = await import('../seeded')
const { WELCOME, WELCOME_PATH } = await import('../welcome')
const { openerFor } = await import('../openers')
const { keptAway, NOT_HERE } = await import('./away.svelte')
const { indexed } = await import('@orden/scan/indexed')

const write = (path: string, content = '') => webInvoke('write_note', { path, content })
const read = (path: string) => webInvoke<string>('read_note', { path })
const paths = () => [...disk.files.keys()].sort()

beforeEach(() => {
  disk.files.clear()
  disk.assets.clear()
  disk.meta.clear()
  disk.snapshots.length = 0
  disk.reads.length = 0
  disk.sized.yes = true
  disk.learnt.clear()
  disk.planes.clear()
  localStorage.clear()
  forgetSeedStore()
  keptAway.clear()
})

describe('a note too large to be one', () => {
  const crate = readFileSync(
    fileURLToPath(new URL('../../../src-tauri/src/notes.rs', import.meta.url)),
    'utf8',
  )

  test('is refused past the ceiling the desktop refuses at, in the same words', () => {
    expect(MOST_NOTE_BYTES).toBe(64 * 1024 * 1024)
    expect(crate).toContain('pub const MOST_NOTE_BYTES: u64 = 64 * 1024 * 1024;')
    expect(crate).toContain(`pub const TOO_LARGE: &str = "${TOO_LARGE}";`)
  })

  test('is counted in bytes, so a note of wide letters is refused before its length is', async () => {
    const at = (content: string) => {
      disk.files.set('/Notes/Dump.md', { path: '/Notes/Dump.md', content, created: 1, modified: 1 })
      return read('/Notes/Dump.md')
    }
    const wide = '€'.repeat(Math.floor(MOST_NOTE_BYTES / 3) + 1)

    await expect(at('x'.repeat(MOST_NOTE_BYTES + 1))).rejects.toThrow(TOO_LARGE)
    await expect(at(wide)).rejects.toThrow(TOO_LARGE)
    expect(await at('x'.repeat(MOST_NOTE_BYTES))).toHaveLength(MOST_NOTE_BYTES)
    expect(await at('€ and more')).toBe('€ and more')
  })
})

describe('a name Windows keeps for a device', () => {
  const refusal = /is a name Windows keeps for a device, so a note or folder cannot be called it/

  test('is refused for a note or a folder made, renamed or copied to it, in the desktop’s words', async () => {
    const crate = readFileSync(
      fileURLToPath(new URL('../../../src-tauri/src/paths.rs', import.meta.url)),
      'utf8',
    )
    expect(crate).toContain(
      'is a name Windows keeps for a device, so a note or folder cannot be called it',
    )
    await write('/Notes/Plan.md', '# Plan')

    await expect(
      webInvoke('rename_note', { from: '/Notes/Plan.md', to: '/Notes/nul.md' }),
    ).rejects.toThrow(refusal)
    await expect(
      webInvoke('rename_note', { from: '/Notes/Plan.md', to: '/Notes/CON .md' }),
    ).rejects.toThrow(refusal)
    await expect(webInvoke('create_folder', { path: '/Notes/COM¹' })).rejects.toThrow(refusal)
    await expect(write('/Notes/lpt1.md', 'x')).rejects.toThrow(refusal)
    await expect(
      webInvoke('copy_path', { from: '/Notes/Plan.md', to: '/Notes/conin$.md' }),
    ).rejects.toThrow(refusal)
    expect(paths()).toEqual(['/Notes/Plan.md'])
  })

  test('is still written and moved for a note that came with it', async () => {
    await webInvoke('write_note', { path: '/Notes/aux.md', content: 'came', arrived: true })
    await write('/Notes/aux.md', 'still written')
    await webInvoke('create_folder', { path: '/Notes/Kept' })
    await webInvoke('rename_note', { from: '/Notes/aux.md', to: '/Notes/Kept/aux.md' })
    expect(await read('/Notes/Kept/aux.md')).toBe('still written')
    await webInvoke('create_folder', { path: '/Notes/PRN', arrived: true })
  })
})

describe('versions of a note', () => {
  const keep = (content: string, source?: string) =>
    webInvoke('snapshot_note', { path: '/Notes/Plane.canvas', content, source })

  test('are compared with the newest alone, and forty are kept', async () => {
    const { snapshots } = await import('./store')
    const every = vi.spyOn(snapshots, 'forNote')
    for (let one = 0; one < 45; one++) await keep(`plane ${String(one)}`)
    await keep('plane 44', 'agent')

    expect(every).not.toHaveBeenCalled()
    expect(disk.snapshots).toHaveLength(40)
    expect(disk.snapshots.at(0)?.content).toBe('plane 5')
    expect(disk.snapshots.at(-1)).toMatchObject({ content: 'plane 44', source: 'agent' })
  })

  test('are read back one at a time by the id the listing gave out', async () => {
    await keep('first')
    await keep('second')
    const id = disk.snapshots.find((one) => one.content === 'first')?.id

    expect(await webInvoke('read_snapshot', { path: String(id) })).toBe('first')
  })
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

  test('refuses a name a folder already has', async () => {
    await write('/Notes/a.md', 'a')
    await write('/Notes/Work/b.md', 'b')

    await expect(
      webInvoke('rename_note', { from: '/Notes/a.md', to: '/Notes/Work' }),
    ).rejects.toThrow()

    expect(paths()).toEqual(['/Notes/Work/b.md', '/Notes/a.md'])
  })

  test('reads only what it moves, never every note and picture held', async () => {
    await write('/Notes/a.md', 'a')
    await write('/Other/big.md', 'x'.repeat(1000))
    disk.assets.set('/Other/huge.png', {
      path: '/Other/huge.png',
      type: 'image/png',
      data: 'AAAA',
      modified: 1,
    })
    const { files, assets } = await import('./store')
    const wholeFiles = vi.spyOn(files, 'all')
    const wholeAssets = vi.spyOn(assets, 'all')

    await webInvoke('rename_note', { from: '/Notes/a.md', to: '/Notes/b.md' })

    expect(paths()).toContain('/Notes/b.md')
    expect(wholeFiles).not.toHaveBeenCalled()
    expect(wholeAssets).not.toHaveBeenCalled()
    wholeFiles.mockRestore()
    wholeAssets.mockRestore()
  })

  test('refused, moves none of the pictures along', async () => {
    await write('/Notes/Trip/a.md', 'a')
    disk.assets.set('/Notes/Trip/map.png', {
      path: '/Notes/Trip/map.png',
      type: 'image/png',
      data: 'AAAA',
      modified: 1,
    })
    await write('/Notes/Done/b.md', 'b')

    await expect(
      webInvoke('rename_note', { from: '/Notes/Trip', to: '/Notes/Done' }),
    ).rejects.toThrow()

    expect([...disk.assets.keys()]).toContain('/Notes/Trip/map.png')
  })

  test('refuses to rename something that is not there', async () => {
    await expect(
      webInvoke('rename_note', { from: '/Notes/gone.md', to: '/Notes/here.md' }),
    ).rejects.toThrow()
  })
})

describe('copying', () => {
  test('takes everything under a folder, both stores, and leaves the original', async () => {
    await write('/Notes/Trip/Trip.md', '# Trip')
    disk.assets.set('/Notes/Trip/map.png', {
      path: '/Notes/Trip/map.png',
      type: 'image/png',
      data: 'AQID',
      modified: 1,
    })

    await webInvoke('copy_path', { from: '/Notes/Trip', to: '/Notes/Trip copy' })

    expect(await read('/Notes/Trip copy/Trip.md')).toBe('# Trip')
    expect(await read('/Notes/Trip/Trip.md')).toBe('# Trip')
    expect(disk.assets.get('/Notes/Trip copy/map.png')?.data).toBe('AQID')
  })

  test("brings a PDF's highlights along", async () => {
    disk.assets.set('/Notes/paper.pdf', {
      path: '/Notes/paper.pdf',
      type: '',
      data: '',
      modified: 1,
    })
    await webInvoke('write_highlights', { path: '/Notes/paper.pdf', content: '{"version":1}' })

    await webInvoke('copy_path', { from: '/Notes/paper.pdf', to: '/Notes/paper copy.pdf' })

    expect(disk.assets.has('/Notes/paper copy.pdf')).toBe(true)
    expect(disk.files.get('/Notes/paper copy.pdf.highlights.json')?.content).toBe('{"version":1}')
  })

  test('never writes over anything, and never into itself', async () => {
    await write('/Notes/a.md', 'a')
    await write('/Notes/b.md', 'b')
    await write('/Notes/Work/c.md', 'c')

    await expect(
      webInvoke('copy_path', { from: '/Notes/a.md', to: '/Notes/b.md' }),
    ).rejects.toThrow()
    await expect(
      webInvoke('copy_path', { from: '/Notes/Work', to: '/Notes/Work/Work' }),
    ).rejects.toThrow()
    expect(await read('/Notes/b.md')).toBe('b')
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

describe('whether anything is at a path', () => {
  test('answers for a note, a picture and a folder, and not for a name it only begins', async () => {
    await write('/Notes/Plan.md', '# Plan')
    await webInvoke('create_folder', { path: '/Notes/Empty' })
    disk.assets.set('/Notes/Pics/shot.png', {
      path: '/Notes/Pics/shot.png',
      type: 'image/png',
      data: 'AAAA',
      modified: 1,
    })
    await webInvoke('save_asset', {
      notePath: '/Notes/Plan.md',
      folder: 'Pics',
      name: 'other.png',
      bytes: [1, 2, 3],
    }).catch(() => undefined)

    const at = (path: string) => webInvoke<boolean>('path_exists', { path })
    expect(await at('/Notes/Plan.md')).toBe(true)
    expect(await at('/Notes')).toBe(true)
    expect(await at('/Notes/Empty')).toBe(true)
    expect(await at('/Notes/Plan')).toBe(false)
    expect(await at('/Notes/Gone.md')).toBe(false)
  })
})

describe('a file the app reads as words, written as bytes', () => {
  const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64')
  const bytesOf = async (path: string) => {
    const uri = await webInvoke<string>('read_asset', { path })
    return Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64').toString('utf8')
  }
  const PDF = '/Notes/Paper.pdf'
  const SIDE = '/Notes/Paper.pdf.highlights.json'

  test('is read as words: a PDF’s highlights, a base and a plane', async () => {
    await webInvoke('write_bytes', { path: SIDE, base64: base64('{"v":1,"from":"desktop"}') })
    await webInvoke('write_bytes', { path: '/Notes/Bugs.base', base64: base64('views: []\n') })
    await webInvoke('write_bytes', { path: '/Notes/Board.canvas', base64: base64('{"nodes":[]}') })

    expect(await webInvoke('read_highlights', { path: PDF })).toBe('{"v":1,"from":"desktop"}')
    expect(await read('/Notes/Bugs.base')).toBe('views: []\n')
    expect(await read('/Notes/Board.canvas')).toBe('{"nodes":[]}')
  })

  test('is read back as the bytes of the words written here since', async () => {
    await webInvoke('write_bytes', { path: SIDE, base64: base64('{"v":1,"old":true}') })
    await webInvoke('write_highlights', { path: PDF, content: '{"v":1,"new":true}' })

    expect(await bytesOf(SIDE)).toBe('{"v":1,"new":true}')
  })

  test('left among the pictures by an earlier build, is read as words', async () => {
    disk.assets.set(SIDE, {
      path: SIDE,
      type: 'application/octet-stream',
      data: base64('{"v":1,"kept":true}'),
      modified: 5,
    })

    expect(await webInvoke('read_highlights', { path: PDF })).toBe('{"v":1,"kept":true}')
    expect(disk.assets.has(SIDE)).toBe(false)
    expect(disk.files.get(SIDE)?.content).toBe('{"v":1,"kept":true}')
  })

  test('a picture is still a picture', async () => {
    await webInvoke('write_bytes', { path: '/Notes/shot.png', base64: 'AAEC' })
    expect(disk.assets.get('/Notes/shot.png')?.data).toBe('AAEC')
    expect(disk.files.has('/Notes/shot.png')).toBe(false)
  })
})

describe('the trash', () => {
  test('a note deleted before its space stays out of a new space of that name', async () => {
    await webInvoke('create_folder', { path: '/Notes' })
    await webInvoke('write_note', { path: '/Notes/Idea.md', content: 'words' })
    const entry = await webInvoke<{ id: string }>('trash_item', {
      path: '/Notes/Idea.md',
      kind: 'note',
    })
    await webInvoke('trash_item', { path: '/Notes', kind: 'space' })
    await webInvoke('create_folder', { path: '/Notes' })
    await webInvoke('rename_space', { from: '/Notes', name: 'Ideas' })

    expect(await webInvoke('restore_trash', { id: entry.id })).toBe('/Notes/Idea.md')
  })

  test('a note deleted out of a space goes back to the space under its new name', async () => {
    await webInvoke('create_folder', { path: '/Notes' })
    await webInvoke('write_note', { path: '/Notes/Idea.md', content: 'words' })
    const entry = await webInvoke<{ id: string }>('trash_item', {
      path: '/Notes/Idea.md',
      kind: 'note',
    })
    await webInvoke('rename_space', { from: '/Notes', name: 'Ideas' })

    expect(await webInvoke('restore_trash', { id: entry.id })).toBe('/Ideas/Idea.md')
  })

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

  test('holds a picture, which lives with the assets alone, and puts it back', async () => {
    disk.assets.set('/Notes/shot.png', {
      path: '/Notes/shot.png',
      type: 'image/png',
      data: 'AAAA',
      modified: 1,
    })

    const entry = await webInvoke<{ id: string }>('trash_item', {
      path: '/Notes/shot.png',
      kind: 'note',
    })
    expect(disk.assets.has('/Notes/shot.png')).toBe(false)

    expect(await webInvoke('restore_trash', { id: entry.id })).toBe('/Notes/shot.png')
    expect(disk.assets.has('/Notes/shot.png')).toBe(true)
  })

  test('puts a picture back beside a newer one of the same name, which keeps its bytes', async () => {
    const picture = (data: string) => ({
      path: '/Notes/shot.png',
      type: 'image/png',
      data,
      modified: 1,
    })
    disk.assets.set('/Notes/shot.png', picture('old'))
    const entry = await webInvoke<{ id: string }>('trash_item', {
      path: '/Notes/shot.png',
      kind: 'note',
    })
    disk.assets.set('/Notes/shot.png', picture('new'))

    expect(await webInvoke('restore_trash', { id: entry.id })).toBe('/Notes/shot 2.png')
    expect(disk.assets.get('/Notes/shot.png')?.data).toBe('new')
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
    for (const held of ['', 'not json', '{"id":"1"}', '42', 'null']) {
      disk.meta.set('trash', held)
      expect(await webInvoke('list_trash'), held).toEqual([])
    }

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

  test('shows a page note, which is a file in the space like any other', async () => {
    await write('/Notes/Journal.pages')
    await write('/Notes/Board.canvas')
    await write('/Notes/a.md')

    const tree = await webInvoke<{ children: { name: string }[] }>('read_tree', { root: '/Notes' })

    expect(tree.children.map((one) => one.name)).toEqual(['a.md', 'Board.canvas', 'Journal.pages'])
  })

  test('lists a file of every kind a tab can hold', async () => {
    const one: Record<Exclude<Opener, 'pdf'>, string> = {
      note: 'a.md',
      web: 'Docs.url',
      pages: 'Journal.pages',
      canvas: 'Board.canvas',
      view: 'Bugs.base',
      chat: 'Team.chat',
      term: 'Build.term',
      application: 'GIMP.application',
    }
    const build = { evenBuild: false, isPlugin: false }
    for (const [kind, name] of Object.entries(one)) {
      expect(
        openerFor(name, () => false, build),
        name,
      ).toBe(kind)
      await write(`/Notes/${name}`, '{}')
    }

    const tree = await webInvoke<{ children: { name: string }[] }>('read_tree', { root: '/Notes' })

    expect(tree.children.map((child) => child.name).sort()).toEqual(Object.values(one).sort())
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

    const every = await webInvoke<{ children: { name: string; path: string }[] }>('read_tree', {
      root: '/Notes',
      options: { every: true },
    })
    expect(every.children.map((one) => one.name)).toEqual([
      'a.md',
      'paper.pdf',
      'paper.pdf.highlights.json',
      'shot.png',
    ])
    await expect(webInvoke('read_note', { path: '/Notes/shot.png' })).rejects.toThrow()
  })
})

describe("a page note's paper", () => {
  const note = '/Notes/Lecture.pages'
  const paper = '/Notes/Lecture.pages.pdf'
  const held = (path: string) => ({ path, type: 'application/pdf', data: 'JVBERg==', modified: 1 })

  beforeEach(async () => {
    await write(note, '{}')
    disk.assets.set(paper, held(paper))
  })

  test('is not listed beside the note, and is once the note has gone', async () => {
    const names = async (options?: { papers?: boolean }) =>
      (
        await webInvoke<{ children: { name: string }[] }>('read_tree', { root: '/Notes', options })
      ).children.map((one) => one.name)

    expect(await names()).toEqual(['Lecture.pages'])
    expect(await names({ papers: true })).toEqual(['Lecture.pages', 'Lecture.pages.pdf'])

    disk.files.delete(note)
    expect(await names()).toEqual(['Lecture.pages.pdf'])
  })

  test('follows the note when it is renamed, with its highlights', async () => {
    await webInvoke('write_highlights', { path: paper, content: '{"version":1}' })

    await webInvoke('rename_note', { from: note, to: '/Notes/Week 1.pages' })

    expect(disk.assets.has(paper)).toBe(false)
    expect(disk.assets.get('/Notes/Week 1.pages.pdf')?.data).toBe('JVBERg==')
    expect(disk.files.has('/Notes/Week 1.pages.pdf.highlights.json')).toBe(true)
  })

  test('follows the note when sync moves it, and leaves its highlights', async () => {
    await webInvoke('write_highlights', { path: paper, content: '{"version":1}' })

    await webInvoke('rename_note', { from: note, to: '/Notes/Week 1.pages', alone: true })

    expect(disk.files.has('/Notes/Week 1.pages')).toBe(true)
    expect(disk.assets.has(paper)).toBe(false)
    expect(disk.assets.get('/Notes/Week 1.pages.pdf')?.data).toBe('JVBERg==')
    expect(disk.files.has('/Notes/Lecture.pages.pdf.highlights.json')).toBe(true)
    expect(disk.files.has('/Notes/Week 1.pages.pdf.highlights.json')).toBe(false)
  })

  test('is never taken from somebody else, however the note moves', async () => {
    disk.assets.set('/Notes/Report.pages.pdf', held('/Notes/Report.pages.pdf'))
    for (const alone of [false, true])
      await expect(
        webInvoke('rename_note', { from: note, to: '/Notes/Report.pages', alone }),
      ).rejects.toThrow('already there')
  })

  test('goes to the trash and comes back with it', async () => {
    const entry = await webInvoke<{ id: string }>('trash_item', { path: note, kind: 'note' })
    expect(disk.assets.has(paper)).toBe(false)

    await webInvoke('restore_trash', { id: entry.id })
    expect(disk.assets.get(paper)?.data).toBe('JVBERg==')
  })

  test('goes to the trash with the note when sync deletes it, without its highlights', async () => {
    await webInvoke('write_highlights', { path: paper, content: '{"version":1}' })

    await webInvoke('trash_item', { path: note, kind: 'note', alone: true })

    expect(disk.files.has(note)).toBe(false)
    expect(disk.assets.has(paper)).toBe(false)
    expect(disk.files.has('/Notes/Lecture.pages.pdf.highlights.json')).toBe(true)
  })

  test('is copied with it, and goes when it goes', async () => {
    await webInvoke('copy_path', { from: note, to: '/Notes/Lecture copy.pages' })
    expect(disk.assets.has('/Notes/Lecture copy.pages.pdf')).toBe(true)
    expect(disk.assets.has(paper)).toBe(true)

    await webInvoke('delete_note', { path: '/Notes/Lecture copy.pages' })
    expect(disk.assets.has('/Notes/Lecture copy.pages.pdf')).toBe(false)
    expect(disk.assets.has(paper)).toBe(true)
  })

  test('is where a PDF beside the note goes when sync holds it there', async () => {
    disk.assets.delete(paper)
    disk.assets.set('/Notes/Lecture.pdf', held('/Notes/Lecture.pdf'))

    await webInvoke('rename_note', { from: '/Notes/Lecture.pdf', to: paper, hold: true })

    expect(disk.assets.has(paper)).toBe(true)
    expect(disk.assets.has('/Notes/Lecture.pdf')).toBe(false)
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

  test('follow a PDF renamed on its own, which is a row of the asset store alone', async () => {
    disk.assets.set(pdf, { path: pdf, type: 'application/pdf', data: '', modified: 1 })
    await webInvoke('write_highlights', { path: pdf, content: '{"version":1}' })

    await webInvoke('rename_note', { from: pdf, to: '/Notes/paper.pages.pdf' })

    expect(disk.assets.has('/Notes/paper.pages.pdf')).toBe(true)
    expect(disk.assets.has(pdf)).toBe(false)
    expect(disk.files.has('/Notes/paper.pages.pdf.highlights.json')).toBe(true)
    expect(disk.files.has(sidecar)).toBe(false)
  })

  test('stay where they are when sync moves the PDF alone', async () => {
    disk.assets.set(pdf, { path: pdf, type: 'application/pdf', data: '', modified: 1 })
    await webInvoke('write_highlights', { path: '/Notes/moved.pdf', content: '{"version":2}' })
    await webInvoke('write_highlights', { path: pdf, content: '{"version":1}' })

    await webInvoke('rename_note', { from: pdf, to: '/Notes/moved.pdf', alone: true })

    expect(disk.assets.has('/Notes/moved.pdf')).toBe(true)
    expect(disk.files.get(sidecar)?.content).toBe('{"version":1}')
    expect(disk.files.get('/Notes/moved.pdf.highlights.json')?.content).toBe('{"version":2}')
  })

  test('stay where they are when sync deletes the PDF', async () => {
    disk.assets.set(pdf, { path: pdf, type: 'application/pdf', data: '', modified: 1 })
    await webInvoke('write_highlights', { path: pdf, content: '{"version":1}' })

    await webInvoke('trash_item', { path: pdf, kind: 'note', alone: true })

    expect(disk.assets.has(pdf)).toBe(false)
    expect(disk.files.get(sidecar)?.content).toBe('{"version":1}')
  })

  test('are rejoined by their PDF when sync deleted the two apart and they came back first', async () => {
    disk.assets.set(pdf, { path: pdf, type: 'application/pdf', data: '', modified: 1 })
    await webInvoke('write_highlights', { path: pdf, content: '{"version":1}' })
    const paper = await webInvoke<{ id: string }>('trash_item', {
      path: pdf,
      kind: 'note',
      alone: true,
    })
    const marks = await webInvoke<{ id: string }>('trash_item', {
      path: sidecar,
      kind: 'note',
      alone: true,
    })

    await webInvoke('restore_trash', { id: marks.id })
    expect(await webInvoke<string>('restore_trash', { id: paper.id })).toBe(pdf)

    expect(disk.files.get(sidecar)?.content).toBe('{"version":1}')
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

describe('a page note and a PDF of its paper’s name', () => {
  const pdf = (path: string) => webInvoke('write_bytes', { path, base64: btoa('%PDF mine') })

  beforeEach(async () => {
    await write('/Notes/A/Report.pages', '{}')
    await pdf('/Notes/B/Report.pages.pdf')
    await write('/Notes/B/Blank.pages', '{}')
    await pdf('/Notes/B/slides.pdf')
  })

  test('a page note is not renamed or copied where its paper would go', async () => {
    for (const command of ['rename_note', 'copy_path']) {
      await expect(
        webInvoke(command, { from: '/Notes/A/Report.pages', to: '/Notes/B/Report.pages' }),
        command,
      ).rejects.toThrow(/already there/)
    }
    expect(disk.files.has('/Notes/A/Report.pages')).toBe(true)
    expect(disk.files.has('/Notes/B/Report.pages')).toBe(false)
  })

  test('nor a PDF where a page note would take it for its paper', async () => {
    for (const command of ['rename_note', 'copy_path']) {
      await expect(
        webInvoke(command, { from: '/Notes/B/slides.pdf', to: '/Notes/B/Blank.pages.pdf' }),
        command,
      ).rejects.toThrow(/already there/)
    }
    expect(disk.assets.has('/Notes/B/slides.pdf')).toBe(true)
    expect(disk.assets.has('/Notes/B/Blank.pages.pdf')).toBe(false)
  })

  test('unless it is a PDF being turned into its page note, which says so', async () => {
    await webInvoke('rename_note', {
      from: '/Notes/B/slides.pdf',
      to: '/Notes/B/Blank.pages.pdf',
      hold: true,
    })
    expect(disk.assets.has('/Notes/B/Blank.pages.pdf')).toBe(true)
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

  test('steps aside from a name a page note would take for its paper', async () => {
    await webInvoke('write_note', { path: '/Notes/Report.pages', content: '{}' })
    const written = await webInvoke<string>('save_asset', {
      notePath: '/Notes/Read me.md',
      folder: '',
      name: 'Report.pages.pdf',
      bytes: [1],
    })

    expect(written).toBe('Report.pages 2.pdf')
    expect([...disk.assets.keys()]).toEqual(['/Notes/Report.pages 2.pdf'])
  })

  const drop = (name: string, bytes = [1]) =>
    webInvoke<string>('save_asset', { notePath: '/Notes/Read me.md', folder: '', name, bytes })

  test('keeps both of two pictures of one name', async () => {
    expect(await drop('scan.pdf', [1])).toBe('scan.pdf')
    expect(await drop('scan.pdf', [2])).toBe('scan 2.pdf')
    expect(await drop('scan.pdf', [2])).toBe('scan 2.pdf')
    expect(disk.assets.size).toBe(2)
  })

  test('is the one copy dropped twice, wherever it stepped aside to', async () => {
    await webInvoke('write_note', { path: '/Notes/Report.pages', content: '{}' })
    expect(await drop('Report.pages.pdf')).toBe('Report.pages 2.pdf')
    expect(await drop('Report.pages.pdf')).toBe('Report.pages 2.pdf')
  })

  test('steps past leftover highlights and a device name', async () => {
    await webInvoke('write_note', { path: '/Notes/X.pdf.highlights.json', content: '[]' })
    expect(await drop('X.pdf')).toBe('X 2.pdf')
    expect(await drop('CON.png')).toBe('_CON.png')
  })

  test('never names a folder with a slash in its name', async () => {
    expect(await drop('a/b.png')).toBe('a-b.png')
    expect([...disk.assets.keys()]).toEqual(['/Notes/a-b.png'])
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

  test('comes back with its stamp, which is what the dropdown reads its name from', async () => {
    const css = stamped({ id: 'rose', name: 'Rose', author: 'Nib', version: '2.0.0' }, ':root {}')
    await webInvoke('write_theme', { id: 'rose', css })

    const listed = await webInvoke<{ id: string; path: string }[]>('list_themes')
    expect(listed).toHaveLength(1)

    const read = await webInvoke<string>('read_theme', { path: listed[0]?.path ?? '' })
    expect(stampOf(read)).toEqual({ id: 'rose', name: 'Rose', author: 'Nib', version: '2.0.0' })
  })
})

describe('what the browser cannot do', () => {
  test('answers the shape that makes the app hide the feature', async () => {
    expect(await webInvoke('has_pandoc')).toBe(false)
    expect(await webInvoke('file_stamp', { path: '/Notes/Idea.md' })).toBeNull()
    expect(await webInvoke('theme_dir')).toBe('')
  })

  test('says so outright for a command nobody has stood in for', async () => {
    await expect(webInvoke('open_the_pod_bay_doors')).rejects.toThrow()
  })
})

describe('the welcome note', () => {
  test('is written on a first visit', async () => {
    await seed()
    expect(await read(WELCOME_PATH)).toBe(WELCOME)
  })

  test('is not written twice, even with nothing left on the disk', async () => {
    await seed()
    disk.files.clear()

    await seed()
    expect(paths()).toEqual([])
  })

  test('is not written to a device that already had notes', async () => {
    await write('/Notes/Mine.md', 'my own')

    await seed()
    expect(paths()).toEqual(['/Notes/Mine.md'])
    expect(seedSpaceRoot()).toBeNull()
  })

  test('marks the space it went into as the default one', async () => {
    await seed()
    const listed = await webInvoke<{ name: string; path: string }[]>('list_spaces')
    expect(listed.map((one) => one.path)).toEqual([seedSpaceRoot()])
  })

  test('and that device is not seeded later either, once it is empty', async () => {
    await write('/Notes/Mine.md', 'my own')
    await seed()
    disk.files.clear()

    await seed()
    expect(paths()).toEqual([])
  })

  test('asks the store that survives a launch, where there is one', async () => {
    let kept = false
    rememberSeedIn({
      read: () => Promise.resolve(kept),
      write: () => {
        kept = true
        return Promise.resolve()
      },
    })

    await seed()
    expect(kept).toBe(true)

    localStorage.clear()
    disk.files.clear()

    await seed()
    expect(paths()).toEqual([])
  })
})

describe('reading a whole space for the link index', () => {
  const MANY = 150

  test('answers every note in the space, in path order, however many chunks it took', async () => {
    for (let at = 0; at < MANY; at++) {
      await write(`/Notes/note-${String(at).padStart(3, '0')}.md`, `# ${at}\n\nsee [[note-000]]\n`)
    }

    const found = await webInvoke<{
      notes: { path: string; links: unknown[] }[]
      files: string[]
    }>('scan_links', { root: '/Notes' })

    expect(found.notes).toHaveLength(MANY)
    expect(found.notes[0]?.path).toBe('note-000.md')
    expect(found.notes.at(-1)?.path).toBe(`note-${String(MANY - 1).padStart(3, '0')}.md`)
    expect(found.notes[5]?.links).toHaveLength(1)
  })

  test('leaves out the scaffolding and keeps the files beside the notes', async () => {
    await write('/Notes/Idea.md', '# idea')
    await write('/Notes/Deep/.keep', '')
    await write('/Notes/paper.pdf.highlights.json', '{}')
    await webInvoke('save_asset', {
      notePath: '/Notes/Idea.md',
      folder: 'pictures',
      name: 'shot.png',
      bytes: [1, 2, 3],
    })

    const found = await webInvoke<{ notes: { path: string }[]; files: string[] }>('scan_links', {
      root: '/Notes',
    })

    expect(found.notes.map((one) => one.path)).toEqual(['Idea.md'])
    expect(found.files).toEqual(['pictures/shot.png'])
  })

  test("leaves the app's own files out, the inbox among them, as the crate's scan does", async () => {
    await write('/Notes/Idea.md', '[[Plan]]')
    await write('/Notes/.Inbox.md', '- [ ] buy eggs [[Idea]]')
    await write('/Notes/.nib/Draft.md', 'x')
    await write('/Notes/.nib/shot.png', '')

    const found = await webInvoke<{ notes: { path: string }[]; files: string[] }>('scan_links', {
      root: '/Notes',
    })

    expect(found.notes.map((one) => one.path)).toEqual(['Idea.md'])
    expect(found.files).toEqual([])
  })

  test('reads a chunk of about the same length at a time, and a long file on its own', async () => {
    const page = 'the wind was steady and the ink took its time. '.repeat(90)
    for (let at = 0; at < 300; at++) {
      await write(`/Notes/note-${String(at).padStart(3, '0')}.md`, `# ${at}\n\n${page}`)
    }
    const plane = JSON.stringify({ nodes: [], nib: { ink: [], padding: 'x'.repeat(3_000_000) } })
    await write('/Notes/note-150.canvas', plane)
    disk.planes.delete('/Notes/note-150.canvas')

    await webInvoke('scan_links', { root: '/Notes' })

    const lengths = disk.reads.map((rows) => rows.reduce((sum, row) => sum + row.content.length, 0))
    for (const [at, rows] of disk.reads.entries()) {
      if (rows.length > 1) expect(lengths[at]).toBeLessThanOrEqual(SCANNED_AT_ONCE)
    }

    const alone = disk.reads.find((rows) => rows.some((row) => row.path.endsWith('.canvas')))
    expect(alone?.map((row) => row.path)).toEqual(['/Notes/note-150.canvas'])
    expect(disk.reads.flat()).toHaveLength(301)
  })

  test('a listing that does not know how long its files are is read as it always was', async () => {
    disk.sized.yes = false
    for (let at = 0; at < 300; at++) {
      await write(`/Notes/note-${String(at).padStart(3, '0')}.md`, `# ${at}`)
    }

    await webInvoke('scan_links', { root: '/Notes' })

    expect(disk.reads.map((rows) => rows.length)).toEqual([128, 128, 44])
  })

  test('and learns them as it reads, so the next scan is read by length', async () => {
    disk.sized.yes = false
    const page = 'the wind was steady and the ink took its time. '.repeat(90)
    for (let at = 0; at < 300; at++) {
      await write(`/Notes/note-${String(at).padStart(3, '0')}.md`, `# ${at}\n\n${page}`)
    }

    await webInvoke('scan_links', { root: '/Notes' })
    expect(disk.learnt.size).toBe(300)

    disk.reads.length = 0
    await webInvoke('scan_links', { root: '/Notes' })
    const lengths = disk.reads.map((rows) => rows.reduce((all, row) => all + row.content.length, 0))
    for (const length of lengths) expect(length).toBeLessThanOrEqual(SCANNED_AT_ONCE)
  })

  const drawn = (icon: string) =>
    JSON.stringify({
      nodes: [{ id: 'a', type: 'file', x: 0, y: 0, width: 1, height: 1, file: 'note-001.md' }],
      edges: [],
      nib: { version: 1, icon, ink: [{ id: 's', points: [] }], padding: 'x'.repeat(100_000) },
    })

  test('never reads a plane whose listing says what the index wants of it', async () => {
    for (let at = 0; at < 20; at++) await write(`/Notes/note-${String(at).padStart(3, '0')}.md`)
    await write('/Notes/note-005.canvas', drawn('rocket'))
    await write('/Notes/Book.pages', JSON.stringify({ nodes: [], padding: 'x'.repeat(100_000) }))

    const found = await webInvoke<{
      notes: { path: string; icon: string | null; links: { target: string }[] }[]
      files: string[]
    }>('scan_links', { root: '/Notes' })

    const read = disk.reads.flat().map((row) => row.path)
    expect(read).not.toContain('/Notes/note-005.canvas')
    expect(read).not.toContain('/Notes/Book.pages')
    expect(read).toHaveLength(20)

    const plane = found.notes.find((one) => one.path === 'note-005.canvas')
    expect(plane?.icon).toBe('rocket')
    expect(plane?.links.map((link) => link.target)).toEqual(['note-001.md'])
    expect(found.files).toEqual(['Book.pages'])
  })

  test('reads a plane written before once, and learns what it wants of it', async () => {
    await write('/Notes/Idea.md', '# idea')
    await write('/Notes/Board.canvas', drawn('rocket'))
    disk.planes.delete('/Notes/Board.canvas')

    await webInvoke('scan_links', { root: '/Notes' })
    expect(disk.reads.flat().map((row) => row.path)).toContain('/Notes/Board.canvas')
    expect(disk.planes.get('/Notes/Board.canvas')).toMatchObject({ icon: 'rocket' })

    disk.reads.length = 0
    const found = await webInvoke<{ notes: { path: string; icon: string | null }[] }>(
      'scan_links',
      { root: '/Notes' },
    )
    expect(disk.reads.flat().map((row) => row.path)).toEqual(['/Notes/Idea.md'])
    expect(found.notes.find((one) => one.path === 'Board.canvas')?.icon).toBe('rocket')
  })

  test('a space nothing is in answers nothing', async () => {
    await write('/Other/Idea.md', '# elsewhere')

    const found = await webInvoke<{ notes: unknown[]; files: string[] }>('scan_links', {
      root: '/Notes',
    })

    expect(found).toEqual({ notes: [], files: [] })
  })
})

describe('a note kept away', () => {
  function away(offline = { yes: false }, paths = ['/Notes/Plan.md']) {
    const asked: string[] = []
    keptAway.keep(
      paths.map((path, at) => ({ id: `n${String(at + 1)}`, path, size: 12, modified: 5 })),
      (path) => {
        asked.push(path)
        if (offline.yes) return Promise.resolve(false)
        for (const one of paths.filter((each) => each === path || each.startsWith(`${path}/`))) {
          disk.files.set(one, { path: one, content: 'Ship Monday', created: 5, modified: 5 })
        }
        return Promise.resolve(true)
      },
    )
    return asked
  }

  test('of a folder are fetched together, in one ask, before the folder goes to Recently deleted', async () => {
    const asked = away({ yes: false }, ['/Notes/Plan.md', '/Notes/Deep/Idea.md', '/Other/x.md'])
    const entry = await webInvoke<{ id: string }>('trash_item', { path: '/Notes', kind: 'folder' })
    expect(asked).toEqual(['/Notes'])
    expect(keptAway.under('/Notes')).toEqual([])
    expect(keptAway.at('/Other/x.md')).not.toBeNull()
    await webInvoke('restore_trash', { id: entry.id })
    expect(disk.files.get('/Notes/Deep/Idea.md')?.content).toBe('Ship Monday')
  })

  test('is listed with its cloud, and counts as there', async () => {
    await write('/Notes/Idea.md', 'idea')
    away()
    const tree = await webInvoke<{ children: { path: string; evicted?: boolean }[] }>('read_tree', {
      root: '/Notes',
    })
    expect(tree.children.map((one) => [one.path, one.evicted === true])).toEqual([
      ['/Notes/Idea.md', false],
      ['/Notes/Plan.md', true],
    ])
    expect(await webInvoke('path_exists', { path: '/Notes/Plan.md' })).toBe(true)
    expect(await webInvoke('path_exists', { path: '/Notes' })).toBe(true)
    expect(await webInvoke('list_spaces')).toEqual([{ name: 'Notes', path: '/Notes' }])
  })

  test('is not there for the engine, which reads the rows as they are', async () => {
    const asked = away()
    const tree = await webInvoke<{ children: unknown[] }>('read_tree', {
      root: '/Notes',
      raw: true,
    })
    expect(tree.children).toEqual([])
    expect(await webInvoke('path_exists', { path: '/Notes/Plan.md', raw: true })).toBe(false)
    await expect(webInvoke('read_note', { path: '/Notes/Plan.md', raw: true })).rejects.toThrow()
    expect(asked).toEqual([])
  })

  test("is not there for the engine's disk, which writes its words where it was listed", async () => {
    const asked = away()
    const { appWorld } = await import('../sync2/app-world')
    const written: string[] = []
    const world = appWorld(() => null, {
      written: (path: string) => void written.push(path),
    } as unknown as Parameters<typeof appWorld>[1])

    expect(await world.disk.exists('/Notes/Plan.md')).toBe(false)
    expect(await world.disk.exists('/Notes')).toBe(false)
    expect(await world.disk.read('/Notes/Plan.md')).toBeNull()
    expect(await world.list?.('/Notes')).toEqual([])
    await world.disk.write('/Notes/Plan.md', 'Ship Monday')
    expect(disk.files.get('/Notes/Plan.md')?.content).toBe('Ship Monday')
    expect(written).toEqual(['/Notes/Plan.md'])
    expect(asked).toEqual([])
  })

  test("is no name in the way of the engine's move, which another device's tree made", async () => {
    const asked = away()
    await write('/Notes/Other.md', 'other')
    const { appWorld } = await import('../sync2/app-world')
    const world = appWorld(() => null, {
      holdingWrites: (_path: string, run: () => Promise<void>) => run(),
      moved: () => Promise.resolve(),
    } as unknown as Parameters<typeof appWorld>[1])

    await world.disk.move('/Notes/Other.md', '/Notes/Plan.md', 'file')
    expect(disk.files.get('/Notes/Plan.md')?.content).toBe('other')
    expect(disk.files.has('/Notes/Other.md')).toBe(false)
    expect(asked).toEqual([])
  })

  test('is fetched when it is read, and read like any other from then on', async () => {
    const asked = away()
    expect(await read('/Notes/Plan.md')).toBe('Ship Monday')
    expect(await read('/Notes/Plan.md')).toBe('Ship Monday')
    expect(asked).toEqual(['/Notes/Plan.md'])
    expect(keptAway.at('/Notes/Plan.md')).toBeNull()
  })

  test('offline, says it is not here rather than that it is not anywhere', async () => {
    away({ yes: true })
    await expect(read('/Notes/Plan.md')).rejects.toThrow(NOT_HERE)
    expect(keptAway.offline).toBe(true)
    expect(keptAway.at('/Notes/Plan.md')).not.toBeNull()
  })

  test('is renamed with no row to move, and no name is given out over it', async () => {
    const asked = away()
    await webInvoke('rename_note', { from: '/Notes/Plan.md', to: '/Notes/Later.md' })
    expect(asked).toEqual([])
    await write('/Notes/Other.md', 'other')
    await expect(
      webInvoke('rename_note', { from: '/Notes/Other.md', to: '/Notes/Plan.md' }),
    ).rejects.toThrow('something already lives there')
  })

  test('moved to another space only once its words are here, and offline is left where it was', async () => {
    const offline = { yes: true }
    away(offline)
    await expect(
      webInvoke('rename_note', { from: '/Notes/Plan.md', to: '/Work/Plan.md' }),
    ).rejects.toThrow(NOT_HERE)
    expect(keptAway.at('/Notes/Plan.md')).not.toBeNull()
    expect(disk.files.has('/Work/Plan.md')).toBe(false)

    offline.yes = false
    expect(await read('/Notes/Plan.md')).toBe('Ship Monday')
    await webInvoke('rename_note', { from: '/Notes/Plan.md', to: '/Work/Plan.md' })
    expect(disk.files.get('/Work/Plan.md')?.content).toBe('Ship Monday')
    expect(disk.files.has('/Notes/Plan.md')).toBe(false)
  })

  test('is fetched before it is copied, and a copy offline is refused', async () => {
    const offline = { yes: true }
    away(offline)
    await expect(
      webInvoke('copy_path', { from: '/Notes/Plan.md', to: '/Notes/Copy.md' }),
    ).rejects.toThrow(NOT_HERE)
    expect(disk.files.has('/Notes/Copy.md')).toBe(false)

    offline.yes = false
    await webInvoke('copy_path', { from: '/Notes', to: '/Copied' })
    expect(disk.files.get('/Copied/Plan.md')?.content).toBe('Ship Monday')
  })

  test('is fetched before the app writes over it, and offline the write is refused', async () => {
    const offline = { yes: true }
    const asked = away(offline)
    await expect(
      webInvoke('write_note', { path: '/Notes/Plan.md', content: 'Ship Friday' }),
    ).rejects.toThrow(NOT_HERE)
    expect(disk.files.has('/Notes/Plan.md')).toBe(false)

    offline.yes = false
    await webInvoke('write_note', { path: '/Notes/Plan.md', content: 'Ship Friday' })
    expect(disk.files.get('/Notes/Plan.md')?.content).toBe('Ship Friday')
    expect(asked).toEqual(['/Notes/Plan.md', '/Notes/Plan.md'])
  })

  test("is written where the engine's disk puts it, with nothing fetched", async () => {
    const asked = away()
    await webInvoke('write_note', { path: '/Notes/Plan.md', content: 'Ship Monday', arrived: true })
    expect(disk.files.get('/Notes/Plan.md')?.content).toBe('Ship Monday')
    expect(asked).toEqual([])
  })

  test('is fetched before the folder holding it goes to Recently deleted, and offline the folder stays', async () => {
    const offline = { yes: true }
    away(offline)
    await write('/Notes/Idea.md', 'idea')
    await expect(webInvoke('trash_item', { path: '/Notes', kind: 'folder' })).rejects.toThrow(
      NOT_HERE,
    )
    expect(disk.files.has('/Notes/Idea.md')).toBe(true)

    offline.yes = false
    const entry = await webInvoke<{ id: string }>('trash_item', { path: '/Notes', kind: 'folder' })
    expect(disk.files.has('/Notes/Idea.md')).toBe(false)
    await webInvoke('restore_trash', { id: entry.id })
    expect(disk.files.get('/Notes/Plan.md')?.content).toBe('Ship Monday')
    expect(disk.files.get('/Notes/Idea.md')?.content).toBe('idea')
  })

  test('is in the link index as the account read it, and by its name before that', async () => {
    await write('/Notes/Idea.md', 'see [[Plan]]')
    keptAway.keep(
      [
        { id: 'n1', path: '/Notes/Work/Plan.md', size: 12, modified: 5 },
        { id: 'n2', path: '/Notes/Later.md', size: 3, modified: 5 },
      ],
      () => Promise.resolve(false),
    )
    const stamp = { size: 12, mtime: 5, ctime: 5 }
    const said = indexed('Plan.md', '# Plan\n\n- [ ] ship #work\n', stamp)
    if (said) keptAway.answeredBy(new Map([['n1', said]]), () => Promise.resolve())

    const found = await webInvoke<SpaceLinks>('scan_links', { root: '/Notes' })
    const plan = found.notes.find((one) => one.path === 'Work/Plan.md')
    expect(plan).toMatchObject({ name: 'Plan', headings: ['Plan'], tags: ['work'] })
    expect(plan?.tasks?.map((one) => one.text)).toEqual(['ship #work'])
    expect(found.notes.find((one) => one.path === 'Later.md')).toMatchObject({
      name: 'Later',
      links: [],
      bare: false,
    })
    expect(found.notes.map((one) => one.path).sort()).toEqual([
      'Idea.md',
      'Later.md',
      'Work/Plan.md',
    ])
    expect(await webInvoke('space_tags', { root: '/Notes' })).toEqual([{ tag: '#work', count: 1 }])
  })

  test('counts the tags of its own space, reading none of the notes of another', async () => {
    away()
    const stamp = { size: 12, mtime: 5, ctime: 5 }
    const said = indexed('Plan.md', '# Plan\n\nkept away #work\n', stamp)
    if (said) keptAway.answeredBy(new Map([['n1', said]]), () => Promise.resolve())
    await write('/Notes/a.md', 'one #work')
    await write('/Notes/Deep/b.md', 'two #work #home')
    await write('/Other/c.md', 'three #home')
    const { files } = await import('./store')
    const whole = vi.spyOn(files, 'all')
    const read = vi.spyOn(files, 'between')

    expect(await webInvoke('space_tags', { root: '/Notes' })).toEqual([
      { tag: '#work', count: 3 },
      { tag: '#home', count: 1 },
    ])
    expect(whole).not.toHaveBeenCalled()
    const rows = await Promise.all(read.mock.results.map((one) => one.value as Promise<FileRow[]>))
    expect(rows.flat().map((row) => row.path)).not.toContain('/Other/c.md')
    whole.mockRestore()
    read.mockRestore()
  })

  test('let go of, its row goes with nothing kept', async () => {
    await write('/Notes/Plan.md', 'Ship Monday')
    await webInvoke('let_go_note', { path: '/Notes/Plan.md' })
    expect(disk.files.has('/Notes/Plan.md')).toBe(false)
    expect(disk.snapshots).toEqual([])
  })
})
