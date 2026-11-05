import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** New spaces kept by Orden itself (#1068, step 4d): made, listed beside the crate's
 *  folders, renamed, deleted into Recently deleted and back, and moved into and out of,
 *  with a crate in memory standing in for the disk. */

const disk = vi.hoisted(() => {
  const files = new Map<string, string | Uint8Array>()
  const dirs = new Set<string>(['/spaces'])
  const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'
  const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)
  const under = (root: string, path: string) => path === root || path.startsWith(`${root}/`)
  const mkdirs = (path: string) => {
    for (let at = path; at && at !== '/'; at = parentOf(at)) {
      if (files.has(at)) throw new Error(`${at} is a file`)
      dirs.add(at)
    }
  }
  const moveAll = (from: string, to: string) => {
    for (const held of [files, dirs] as (Map<string, unknown> | Set<string>)[]) {
      const keys = [...held.keys()].filter((one) => under(from, one))
      for (const one of keys) {
        const value = held instanceof Map ? held.get(one) : undefined
        held.delete(one)
        if (held instanceof Map) held.set(`${to}${one.slice(from.length)}`, value)
        else held.add(`${to}${one.slice(from.length)}`)
      }
    }
  }
  let trashed = 0
  const rehomed: string[] = []
  const trash: { id: string; kind: string; name: string; from: string; trashedAt: number }[] = []
  interface Node {
    name: string
    path: string
    is_dir: boolean
    children: Node[]
  }
  const tree = (root: string, hidden: boolean): Node => ({
    name: nameOf(root),
    path: root,
    is_dir: true,
    children: [...new Set([...files.keys(), ...dirs])]
      .filter((one) => parentOf(one) === root && (hidden || !nameOf(one).startsWith('.')))
      .sort()
      .map((one) =>
        dirs.has(one)
          ? tree(one, hidden)
          : { name: nameOf(one), path: one, is_dir: false, children: [] },
      ),
  })
  const crate = (command: string, args: Record<string, unknown>): unknown => {
    const path = args.path as string
    switch (command) {
      case 'spaces_root':
        return '/spaces'
      case 'list_spaces':
        return [...dirs]
          .filter((one) => parentOf(one) === '/spaces' && !nameOf(one).startsWith('.'))
          .sort()
          .map((one) => ({ name: nameOf(one), path: one }))
      case 'create_space':
        mkdirs(`/spaces/${String(args.name)}`)
        return { name: args.name, path: `/spaces/${String(args.name)}` }
      case 'read_tree': {
        const root = args.root as string
        if (!dirs.has(root)) throw new Error(`${root} is not a folder`)
        return tree(
          root,
          (args.options as { showHidden?: boolean } | undefined)?.showHidden === true,
        )
      }
      case 'write_note':
        mkdirs(parentOf(path))
        files.set(path, args.content as string)
        return undefined
      case 'write_bytes': {
        mkdirs(parentOf(path))
        files.set(
          path,
          Uint8Array.from(atob(args.base64 as string), (one) => one.charCodeAt(0)),
        )
        return undefined
      }
      case 'read_note': {
        const held = files.get(path)
        if (held === undefined) throw new Error('no such note')
        return typeof held === 'string' ? held : new TextDecoder().decode(held)
      }
      case 'read_file': {
        const held = files.get(path)
        if (held === undefined) throw new Error('no such file')
        return (typeof held === 'string' ? new TextEncoder().encode(held) : held).slice().buffer
      }
      case 'copy_path': {
        const from = args.from as string
        const to = args.to as string
        if (files.has(to) || dirs.has(to)) throw new Error('something already lives there')
        mkdirs(parentOf(to))
        for (const one of [...dirs])
          if (under(from, one)) dirs.add(`${to}${one.slice(from.length)}`)
        for (const [one, held] of [...files]) {
          if (under(from, one)) files.set(`${to}${one.slice(from.length)}`, held)
        }
        return undefined
      }
      case 'rehome_snapshots':
        rehomed.push(`${String(args.from)} -> ${String(args.to)}`)
        return 1
      case 'path_taken':
        return files.has(path) || dirs.has(path)
      case 'file_stamp': {
        const held = files.get(path)
        return held === undefined ? null : { modified: 1, len: held.length }
      }
      case 'delete_note':
        if (!files.delete(path)) throw new Error('nothing to delete')
        return undefined
      case 'create_folder':
        mkdirs(path)
        return undefined
      case 'delete_folder':
        for (const one of [...files.keys()]) if (under(path, one)) files.delete(one)
        for (const one of [...dirs]) if (under(path, one)) dirs.delete(one)
        return undefined
      case 'rename_note':
        moveAll(args.from as string, args.to as string)
        return undefined
      case 'trash_item': {
        const id = `t${String((trashed += 1))}`
        moveAll(path, `/spaces/.trash/${id}`)
        const entry = {
          id,
          kind: args.kind as string,
          name: nameOf(path),
          from: path,
          trashedAt: 1,
        }
        trash.push(entry)
        return entry
      }
      case 'list_trash':
        return [...trash]
      case 'restore_trash': {
        const at = trash.findIndex((one) => one.id === args.id)
        const [entry] = trash.splice(at, 1)
        if (!entry) throw new Error('nothing to restore')
        moveAll(`/spaces/.trash/${entry.id}`, entry.from)
        return entry.from
      }
      default:
        throw new Error(`the memory crate has no ${command}`)
    }
  }
  return {
    files,
    dirs,
    rehomed,
    trash,
    crate,
  }
})

vi.mock('../native', () => ({
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    try {
      return Promise.resolve(disk.crate(command, args))
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  },
}))

/** The system's folder dialog: what opened it, which an agent's command never does. */
const dialogs = vi.hoisted(() => ({ opened: 0 }))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: () => {
    dialogs.opened += 1
    return Promise.resolve('/shown')
  },
}))

// The window's storage, where this device says it keeps new spaces itself.
const said = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => said.get(key) ?? null,
  setItem: (key: string, value: string) => void said.set(key, value),
  removeItem: (key: string) => void said.delete(key),
})

const { internalInvoke } = await import('./route')
const { KEEP_SPACES } = await import('./spaces')

const call = <T>(command: string, args: Record<string, unknown> = {}) =>
  internalInvoke<T>(command, args)

beforeEach(() => {
  localStorage.setItem(KEEP_SPACES, 'on')
})

afterEach(async () => {
  // Every space let go, and the disk as it was, for the next test.
  for (const space of await call<{ path: string }[]>('list_spaces')) {
    if (space.path.includes('/.orden/')) await call('delete_space', { path: space.path })
  }
  disk.files.clear()
  for (const one of [...disk.dirs]) if (one !== '/spaces') disk.dirs.delete(one)
  disk.rehomed.length = 0
  disk.trash.length = 0
  localStorage.removeItem(KEEP_SPACES)
})

describe('a new space, where this device keeps new spaces itself', () => {
  test("is a folder of Orden's own, listed beside the crate's, its root a file nothing goes under", async () => {
    disk.dirs.add('/spaces/Disk')
    const made = await call<{ name: string; path: string }>('create_space', { name: 'Plans' })

    expect(made).toEqual({ name: 'Plans', path: '/spaces/.orden/Plans/Plans' })
    expect(await call('list_spaces')).toEqual([
      { name: 'Disk', path: '/spaces/Disk' },
      { name: 'Plans', path: '/spaces/.orden/Plans/Plans' },
    ])
    await call('write_note', { path: `${made.path}/Work/Plan.md`, content: 'ship it' })
    expect(await call('read_note', { path: `${made.path}/Work/Plan.md` })).toBe('ship it')
    const stored = [...disk.files.keys()].filter((one) => one.includes('/.entries/'))
    expect(stored).toHaveLength(1)
    expect(disk.files.get(stored[0] ?? '')).toBe('ship it')
    // A call that reached the crate with a path in the space by mistake: refused.
    expect(() => disk.crate('write_note', { path: `${made.path}/Lost.md`, content: 'x' })).toThrow(
      'is a file',
    )
    // Named as no space here is.
    expect(await call('create_space', { name: 'Disk' })).toEqual({
      name: 'Disk 2',
      path: '/spaces/.orden/Disk 2/Disk 2',
    })
  })

  test("is a folder of the crate's, as ever, where this device does not say otherwise", async () => {
    localStorage.removeItem(KEEP_SPACES)
    expect(await call('create_space', { name: 'Plain' })).toEqual({
      name: 'Plain',
      path: '/spaces/Plain',
    })
  })

  test('is found where an earlier session left it, and renamed with nothing in it moving', async () => {
    // As a session before this one wrote it: a folder, its index, one file's bytes, and
    // no file at the root - a rename cut short leaves it so.
    const folder = '/spaces/.orden/Plans'
    disk.dirs.add('/spaces/.orden')
    disk.dirs.add(folder)
    disk.files.set(`${folder}/.entries/k1.md`, 'ship it')
    const entry = { key: 'k1.md', made: 1, modified: 1, size: 7 }
    disk.files.set(
      `${folder}/.index.0.json`,
      JSON.stringify({ index: 1, gen: 1, paths: { 'Plan.md': entry }, trash: [] }),
    )

    expect(await call('list_spaces')).toEqual([{ name: 'Plans', path: `${folder}/Plans` }])
    expect(disk.files.has(`${folder}/Plans`)).toBe(true)
    expect(await call('read_note', { path: `${folder}/Plans/Plan.md` })).toBe('ship it')

    const renamed = await call<{ path: string }>('rename_space', {
      from: `${folder}/Plans`,
      name: 'Goals',
    })
    expect(renamed.path).toBe('/spaces/.orden/Goals/Goals')
    expect(await call('read_note', { path: `${renamed.path}/Plan.md` })).toBe('ship it')
    expect(disk.files.get('/spaces/.orden/Goals/.entries/k1.md')).toBe('ship it')
    expect(disk.files.has('/spaces/.orden/Goals/Plans')).toBe(false)
    expect(await call('list_spaces')).toEqual([{ name: 'Goals', path: renamed.path }])
  })

  test('goes to Recently deleted whole and comes back from it', async () => {
    const made = await call<{ path: string }>('create_space', { name: 'Plans' })
    await call('write_note', { path: `${made.path}/Plan.md`, content: 'ship it' })

    const item = await call<{ id: string; kind: string }>('trash_item', {
      path: made.path,
      kind: 'space',
    })
    expect(item.kind).toBe('space')
    expect(await call('list_spaces')).toEqual([])

    await call('restore_trash', { id: item.id })
    expect(await call('list_spaces')).toEqual([{ name: 'Plans', path: made.path }])
    expect(await call('read_note', { path: `${made.path}/Plan.md` })).toBe('ship it')
  })

  test('takes a note in from a folder, and gives one back, bytes and all', async () => {
    disk.dirs.add('/spaces/Disk')
    disk.files.set('/spaces/Disk/Paper.pdf', new Uint8Array([1, 2, 3]))
    disk.files.set('/spaces/Disk/Paper.pdf.highlights.json', '[]')
    disk.files.set('/spaces/Disk/Work/Plan.md', 'ship it')
    disk.dirs.add('/spaces/Disk/Work')
    const made = await call<{ path: string }>('create_space', { name: 'Plans' })

    await call('rename_note', { from: '/spaces/Disk/Paper.pdf', to: `${made.path}/Paper.pdf` })
    await call('rename_note', { from: '/spaces/Disk/Work', to: `${made.path}/Work` })

    expect(disk.files.has('/spaces/Disk/Paper.pdf')).toBe(false)
    expect(disk.files.has('/spaces/Disk/Paper.pdf.highlights.json')).toBe(false)
    expect(disk.dirs.has('/spaces/Disk/Work')).toBe(false)
    expect(await call('read_highlights', { path: `${made.path}/Paper.pdf` })).toBe('[]')
    expect(await call('read_note', { path: `${made.path}/Work/Plan.md` })).toBe('ship it')
    expect(
      new Uint8Array(await call<ArrayBuffer>('read_file', { path: `${made.path}/Paper.pdf` })),
    ).toEqual(new Uint8Array([1, 2, 3]))

    await call('rename_note', { from: `${made.path}/Work`, to: '/spaces/Disk/Back' })
    expect(disk.files.get('/spaces/Disk/Back/Plan.md')).toEqual(new TextEncoder().encode('ship it'))
    expect(await call('path_exists', { path: `${made.path}/Work` })).toBe(false)

    const other = await call<{ path: string }>('create_space', { name: 'Other' })
    await call('rename_note', { from: `${made.path}/Paper.pdf`, to: `${other.path}/Paper.pdf` })
    expect(await call('read_highlights', { path: `${other.path}/Paper.pdf` })).toBe('[]')
    expect(await call('path_exists', { path: `${made.path}/Paper.pdf` })).toBe(false)
  })
})

describe('a space that is a folder, where this device keeps new spaces itself', () => {
  /** The workspace, as much of it as a conversion asks: the list, a hold on what is open
   *  under a folder, and the move said once. */
  function workspace(roots: string[]) {
    const said: string[] = []
    const ws = {
      spaces: roots.map((root, at) => ({
        id: `s${String(at)}`,
        name: root.split('/').pop() ?? '',
        root,
      })),
      activeSpaceId: 's0',
      tree: null,
      naming: null,
      notes: [],
      tabs: [],
      setsRead: undefined,
      held: [] as string[],
      during: null as (() => void) | null,
      fileMoved: (from: string, to: string, kind: 'space') => {
        said.push(`${kind} ${from} -> ${to}`)
        return Promise.resolve()
      },
      fileGone: () => Promise.resolve(),
      async holdingUnder(path: string, run: () => Promise<void>) {
        ws.held.push(path)
        ws.during?.()
        await run()
      },
      close: () => undefined,
      clearSelection: () => undefined,
      loadTree: () => Promise.resolve(),
      persist: () => undefined,
    }
    return { ws, said }
  }

  test('is copied whole, checked, and moved to its new root; the folder stays as it was', async () => {
    const { convertAll } = await import('./convert')
    disk.dirs.add('/spaces/Notes')
    disk.dirs.add('/spaces/Notes/Work')
    disk.dirs.add('/spaces/Notes/Empty')
    disk.files.set('/spaces/Notes/Plan.md', 'ship it')
    disk.files.set('/spaces/Notes/Work/cat.png', new Uint8Array([1, 2]))
    disk.files.set('/spaces/Notes/.Inbox.md', '- [ ] eggs')
    disk.dirs.add('/spaces/Notes/.obsidian')
    disk.files.set('/spaces/Notes/.obsidian/app.json', '{}')
    disk.files.set('/spaces/Notes/.obsidian/plugins.json', 'theirs')
    const before = new Map(disk.files)
    const { ws, said } = workspace(['/spaces/Notes'])
    // Written while the rest was being copied, before the hold.
    ws.during = () => disk.files.set('/spaces/Notes/Plan.md', 'ship it today')

    await convertAll(ws)

    const root = '/spaces/.orden/Notes/Notes'
    expect(said).toEqual([`space /spaces/Notes -> ${root}`])
    expect(ws.spaces[0]?.root).toBe(root)
    expect(ws.held).toEqual(['/spaces/Notes'])
    expect(await call('read_note', { path: `${root}/Plan.md` })).toBe('ship it today')
    expect(await call('read_note', { path: `${root}/.Inbox.md` })).toBe('- [ ] eggs')
    expect(
      new Uint8Array(await call<ArrayBuffer>('read_file', { path: `${root}/Work/cat.png` })),
    ).toEqual(new Uint8Array([1, 2]))
    expect(await call('path_exists', { path: `${root}/Empty` })).toBe(true)
    // What says it was a vault, and nothing else of Obsidian's; and its versions with it.
    expect(await call('path_exists', { path: `${root}/.obsidian/app.json` })).toBe(true)
    expect(await call('path_exists', { path: `${root}/.obsidian/plugins.json` })).toBe(false)
    expect(disk.rehomed).toEqual([`/spaces/Notes -> ${root}`])
    // The folder as it was, bar what was written into it before the hold; and listed no more.
    for (const [path, held] of before) {
      if (path !== '/spaces/Notes/Plan.md') expect(disk.files.get(path)).toEqual(held)
    }
    expect(await call('list_spaces')).toEqual([{ name: 'Notes', path: root }])
    // And the folder as it was before anything was made of it, whole, where no list sees.
    const backup = [...disk.dirs].find((one) => one.startsWith('/spaces/.orden/.backups/Notes '))
    expect(disk.files.get(`${backup ?? ''}/Plan.md`)).toBe('ship it')
    expect(disk.files.get(`${backup ?? ''}/Work/cat.png`)).toEqual(new Uint8Array([1, 2]))

    // Once: the next launch finds nothing to do, and a delete leaves the folder no space.
    await convertAll(ws)
    expect(said).toHaveLength(1)
    await call('delete_space', { path: root })
    expect(await call('list_spaces')).toEqual([])
  })

  test('stays the folder where a copy does not read back as it was', async () => {
    const { convertSpace } = await import('./convert')
    disk.dirs.add('/spaces/Notes')
    disk.files.set('/spaces/Notes/Plan.md', 'ship it')
    const { ws, said } = workspace(['/spaces/Notes'])
    const write = disk.crate
    disk.crate = (command, args) => {
      // Every byte written into a kept space's folder comes out wrong.
      if (command === 'write_bytes' && String(args.path).includes('/.entries/')) {
        return write(command, { ...args, base64: 'AA==' })
      }
      return write(command, args)
    }
    try {
      expect(await convertSpace(ws, 's0')).toBe(false)
    } finally {
      disk.crate = write
    }

    expect(said).toEqual([])
    expect(ws.spaces[0]?.root).toBe('/spaces/Notes')
    expect(disk.dirs.has('/spaces/.orden/Notes')).toBe(false)
    expect(await call('list_spaces')).toEqual([{ name: 'Notes', path: '/spaces/Notes' }])
  })

  test('is left as it is where this device does not say otherwise', async () => {
    const { convertAll } = await import('./convert')
    localStorage.removeItem(KEEP_SPACES)
    disk.dirs.add('/spaces/Notes')
    const { ws, said } = workspace(['/spaces/Notes'])
    await convertAll(ws)
    expect(said).toEqual([])
  })
})

describe('a space written out as Markdown and folders', () => {
  test('is every file of it where it is, its inbox too, into a folder of its own', async () => {
    const { exportSpaceTo } = await import('./export')
    const made = await call<{ path: string }>('create_space', { name: 'Plans' })
    await call('write_note', { path: `${made.path}/Work/Plan.md`, content: 'ship it' })
    await call('write_note', { path: `${made.path}/.Inbox.md`, content: '- [ ] eggs' })
    await call('write_bytes', { path: `${made.path}/cat.png`, base64: 'AQI=' })
    disk.dirs.add('/picked/Plans')

    expect(await exportSpaceTo(made.path, 'Plans', '/picked')).toBe('/picked/Plans 2')
    expect(disk.files.get('/picked/Plans 2/Work/Plan.md')).toEqual(
      new TextEncoder().encode('ship it'),
    )
    expect(disk.files.get('/picked/Plans 2/.Inbox.md')).toEqual(
      new TextEncoder().encode('- [ ] eggs'),
    )
    expect(disk.files.get('/picked/Plans 2/cat.png')).toEqual(new Uint8Array([1, 2]))
  })

  test('is the same from a space that is a folder', async () => {
    const { exportSpaceTo } = await import('./export')
    disk.dirs.add('/spaces/Disk')
    disk.dirs.add('/spaces/Disk/Work')
    disk.files.set('/spaces/Disk/Work/Plan.md', 'ship it')
    disk.files.set('/spaces/Disk/.Inbox.md', '- [ ] eggs')

    await exportSpaceTo('/spaces/Disk', 'Disk', '/picked')
    expect(disk.files.get('/picked/Disk/Work/Plan.md')).toEqual(new TextEncoder().encode('ship it'))
    expect(disk.files.get('/picked/Disk/.Inbox.md')).toEqual(new TextEncoder().encode('- [ ] eggs'))
  })
})

describe("a space written out for an agent's command (#1078)", () => {
  test('goes into the folder its path names, and the dialog is never shown', async () => {
    const { answerNextDialog } = await import('../dialog-answer')
    const { exportSpace } = await import('./export')
    disk.dirs.add('/spaces/Disk')
    disk.files.set('/spaces/Disk/Plan.md', 'ship it')
    const asked: boolean[] = []
    answerNextDialog((write) => {
      asked.push(write)
      return Promise.resolve('/agent')
    })

    const opened = dialogs.opened
    expect(await exportSpace('/spaces/Disk', 'Disk')).toBe('/agent/Disk')
    expect(asked).toEqual([true])
    expect(dialogs.opened).toBe(opened)
    expect(disk.files.get('/agent/Disk/Plan.md')).toEqual(new TextEncoder().encode('ship it'))
  })

  test('writes nothing where the crate refused the path', async () => {
    const { answerNextDialog } = await import('../dialog-answer')
    const { exportSpace } = await import('./export')
    disk.dirs.add('/spaces/Disk')
    disk.files.set('/spaces/Disk/Plan.md', 'ship it')
    answerNextDialog(() => Promise.resolve(null))
    const files = disk.files.size
    const opened = dialogs.opened

    expect(await exportSpace('/spaces/Disk', 'Disk')).toBeNull()
    expect(disk.files.size).toBe(files)
    expect(dialogs.opened).toBe(opened)
  })

  test('shows the reader the dialog when no agent answered it', async () => {
    const { exportSpace } = await import('./export')
    disk.dirs.add('/spaces/Disk')
    disk.files.set('/spaces/Disk/Plan.md', 'ship it')
    const opened = dialogs.opened

    expect(await exportSpace('/spaces/Disk', 'Disk')).toBe('/shown/Disk')
    expect(dialogs.opened).toBe(opened + 1)
  })
})

describe('a kept space the launch has not mounted yet', () => {
  test('is waited for and read off its index, never listed as a folder of nothing', async () => {
    const { listInternal } = await import('./watch')
    const { keptShaped } = await import('./roots')
    const folder = '/spaces/.orden/Plans'
    disk.dirs.add('/spaces/.orden')
    disk.dirs.add(folder)
    disk.files.set(`${folder}/Plans`, '')
    disk.files.set(`${folder}/.entries/k1.md`, 'ship it')
    const entry = { key: 'k1.md', made: 1, modified: 1, size: 7 }
    disk.files.set(
      `${folder}/.index.0.json`,
      JSON.stringify({ index: 1, gen: 1, paths: { 'Plan.md': entry }, trash: [] }),
    )

    expect(keptShaped(`${folder}/Plans`)).toBe(true)
    expect(keptShaped('/spaces/Plans')).toBe(false)
    expect(keptShaped('/spaces/.orden/Plans/Other')).toBe(false)
    expect((await listInternal(`${folder}/Plans`))?.map((one) => one.path)).toEqual([
      `${folder}/Plans/Plan.md`,
    ])
    expect(await listInternal('/spaces/Disk')).toBeNull()
  })
})

describe('making a folder a kept space, whatever happens on the way', () => {
  function workspace(root: string) {
    const said: string[] = []
    const ws = {
      spaces: [{ id: 's0', name: root.split('/').pop() ?? '', root }],
      activeSpaceId: 's0',
      tree: null,
      naming: null,
      notes: [],
      tabs: [],
      setsRead: undefined,
      fileMoved: (from: string, to: string) => {
        said.push(`${from} -> ${to}`)
        return Promise.resolve()
      },
      fileGone: () => Promise.resolve(),
      holdingUnder: (_path: string, run: () => Promise<void>) => run(),
      close: () => undefined,
      clearSelection: () => undefined,
      loadTree: () => Promise.resolve(),
      persist: () => undefined,
    }
    return { ws, said }
  }
  const notes = () => {
    disk.dirs.add('/spaces/Notes')
    disk.dirs.add('/spaces/Notes/Work')
    disk.files.set('/spaces/Notes/Plan.md', 'ship it')
    disk.files.set('/spaces/Notes/Work/Old.md', 'old')
  }

  test('stays the folder, whole, where the disk fills up halfway', async () => {
    const { convertSpace } = await import('./convert')
    notes()
    const before = new Map(disk.files)
    const { ws, said } = workspace('/spaces/Notes')
    const write = disk.crate
    let written = 0
    disk.crate = (command, args) => {
      if (command === 'write_bytes' && String(args.path).includes('/.entries/') && ++written > 1) {
        throw new Error('No space left on device')
      }
      return write(command, args)
    }
    try {
      expect(await convertSpace(ws, 's0')).toBe(false)
    } finally {
      disk.crate = write
    }
    expect(said).toEqual([])
    for (const [path, held] of before) expect(disk.files.get(path)).toEqual(held)
    expect(disk.dirs.has('/spaces/.orden/Notes')).toBe(false)
    expect(await call('list_spaces')).toEqual([{ name: 'Notes', path: '/spaces/Notes' }])
  })

  test('cut short by a crash, is never listed half made, and is made again from the start', async () => {
    const { convertAll } = await import('./convert')
    notes()
    // As a crash leaves it: the folder begun, half copied, its root never written.
    disk.dirs.add('/spaces/.orden')
    disk.dirs.add('/spaces/.orden/Notes')
    disk.files.set('/spaces/.orden/Notes/.converting', '/spaces/Notes')
    disk.files.set('/spaces/.orden/Notes/.entries/half.md', 'ship')
    expect(await call('list_spaces')).toEqual([{ name: 'Notes', path: '/spaces/Notes' }])

    const { ws, said } = workspace('/spaces/Notes')
    // Twice at once, as two turns of a launch might ask: made once.
    await Promise.all([convertAll(ws), convertAll(ws)])
    const root = '/spaces/.orden/Notes/Notes'
    expect(said).toEqual([`/spaces/Notes -> ${root}`])
    expect(disk.files.has('/spaces/.orden/Notes/.converting')).toBe(false)
    expect(disk.files.has('/spaces/.orden/Notes/.entries/half.md')).toBe(false)
    expect(await call('read_note', { path: `${root}/Work/Old.md` })).toBe('old')
  })

  test('keeps names of every kind, and refuses two that are one name here', async () => {
    const { convertSpace } = await import('./convert')
    disk.dirs.add('/spaces/Notes')
    disk.dirs.add('/spaces/Notes/日本語')
    const odd = ['Ünïcode café.md', '日本語/ノート.md', 'a #b%c&+.md', '😀 smile.md', 'Ω.pages']
    for (const name of odd) disk.files.set(`/spaces/Notes/${name}`, name)
    const { ws } = workspace('/spaces/Notes')
    expect(await convertSpace(ws, 's0')).toBe(true)
    for (const name of odd) {
      expect(await call('read_note', { path: `/spaces/.orden/Notes/Notes/${name}` })).toBe(name)
    }

    disk.dirs.add('/spaces/Twice')
    disk.files.set('/spaces/Twice/plan.md', 'one')
    disk.files.set('/spaces/Twice/Plan.md', 'two')
    const twice = workspace('/spaces/Twice')
    expect(await convertSpace(twice.ws, 's0')).toBe(false)
    expect(disk.files.get('/spaces/Twice/plan.md')).toBe('one')
    expect(disk.files.get('/spaces/Twice/Plan.md')).toBe('two')
  })

  test('is turned back into the folder, with what was written since, and stays one', async () => {
    const { convertAll, revertSpace } = await import('./convert')
    notes()
    const { ws, said } = workspace('/spaces/Notes')
    await convertAll(ws)
    const root = '/spaces/.orden/Notes/Notes'
    await call('write_note', { path: `${root}/Plan.md`, content: 'ship it today' })
    await call('write_note', { path: `${root}/New.md`, content: 'new' })
    await call('delete_note', { path: `${root}/Work/Old.md` })

    expect(await revertSpace(ws, 's0')).toBe(true)

    expect(said).toEqual([`/spaces/Notes -> ${root}`, `${root} -> /spaces/Notes`])
    expect(ws.spaces[0]?.root).toBe('/spaces/Notes')
    expect(disk.files.get('/spaces/Notes/Plan.md')).toEqual(
      new TextEncoder().encode('ship it today'),
    )
    expect(disk.files.get('/spaces/Notes/New.md')).toEqual(new TextEncoder().encode('new'))
    // Gone from the space, so gone from the folder - into Recently deleted.
    expect(disk.files.has('/spaces/Notes/Work/Old.md')).toBe(false)
    expect(disk.trash.map((one) => one.from)).toEqual([
      '/spaces/Notes/Work/Old.md',
      '/spaces/.orden/Notes',
    ])
    // Backed up before it was written into, as before it was first made a space.
    const backups = [...disk.dirs].filter((one) =>
      /^\/spaces\/\.orden\/\.backups\/[^/]+$/.test(one),
    )
    expect(backups).toHaveLength(2)
    expect(await call('list_spaces')).toEqual([{ name: 'Notes', path: '/spaces/Notes' }])
    await convertAll(ws)
    expect(said).toHaveLength(2)
  })
})
