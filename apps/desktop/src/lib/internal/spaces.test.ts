import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test, vi } from 'vitest'

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
          args.bytes instanceof Uint8Array
            ? args.bytes
            : Uint8Array.from(atob(args.base64 as string), (one) => one.charCodeAt(0)),
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

const dialogs = vi.hoisted(() => ({ opened: 0 }))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: () => {
    dialogs.opened += 1
    return Promise.resolve('/shown')
  },
}))

const said = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => said.get(key) ?? null,
  setItem: (key: string, value: string) => void said.set(key, value),
  removeItem: (key: string) => void said.delete(key),
})

const { internalInvoke } = await import('./route')

const call = <T>(command: string, args: Record<string, unknown> = {}) =>
  internalInvoke<T>(command, args)

afterEach(async () => {
  for (const space of await call<{ path: string }[]>('list_spaces')) {
    if (space.path.includes('/.orden/')) await call('delete_space', { path: space.path })
  }
  disk.files.clear()
  for (const one of [...disk.dirs]) if (one !== '/spaces') disk.dirs.delete(one)
  disk.rehomed.length = 0
  disk.trash.length = 0
  said.clear()
})

describe('a new space', () => {
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
    expect(() => disk.crate('write_note', { path: `${made.path}/Lost.md`, content: 'x' })).toThrow(
      'is a file',
    )
    expect(await call('create_space', { name: 'Disk' })).toEqual({
      name: 'Disk 2',
      path: '/spaces/.orden/Disk 2/Disk 2',
    })
  })

  test('is kept by Orden whatever this device has stored, and never a folder of the crate', async () => {
    const write = disk.crate
    const asked: string[] = []
    disk.crate = (command, args) => {
      asked.push(command)
      return write(command, args)
    }
    try {
      for (const stored of [null, 'off', 'on', 'no']) {
        if (stored === null) localStorage.removeItem('orden:keep-spaces')
        else localStorage.setItem('orden:keep-spaces', stored)
        const name = `Plain ${String(stored)}`
        expect(await call('create_space', { name })).toEqual({
          name,
          path: `/spaces/.orden/${name}/${name}`,
        })
      }
    } finally {
      disk.crate = write
    }
    expect(asked).not.toContain('create_space')
    expect([...disk.dirs].filter((one) => one.split('/').length === 3)).toEqual(['/spaces/.orden'])
  })

  test('is found where an earlier session left it, and renamed with nothing in it moving', async () => {
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

describe('a space that is a folder', () => {
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
      deleted: [] as string[],
      deleteSpace(id: string) {
        ws.deleted.push(id)
        ws.spaces = ws.spaces.filter((one) => one.id !== id)
        return Promise.resolve()
      },
    }
    return { ws, said }
  }

  async function twinned(edit: (kept: string, twin: string) => Promise<unknown>) {
    const { convertAll, retireTwins } = await import('./convert')
    disk.dirs.add('/spaces/Notes')
    disk.files.set('/spaces/Notes/Plan.md', 'ship it')
    const { ws } = workspace(['/spaces/Notes'])
    await convertAll(ws)
    disk.files.set('/spaces/.orden/Notes/.from', '/old/home/Notes')
    ws.spaces.push({ id: 's1', name: 'Notes', root: '/spaces/Notes' })
    await convertAll(ws)
    const twin = ws.spaces.find((one) => one.id === 's1')?.root ?? ''
    expect(twin).toBe('/spaces/.orden/Notes 2/Notes 2')
    disk.files.set('/spaces/.orden/Notes/.from', '/spaces/Notes')
    await edit('/spaces/.orden/Notes/Notes', twin)
    await retireTwins(ws)
    return ws
  }

  test('made twice from one folder after its home moved, the copy that adds nothing goes to the trash', async () => {
    const ws = await twinned(() => Promise.resolve())
    expect(ws.deleted).toEqual(['s1'])
    expect(ws.spaces.map((one) => one.root)).toEqual(['/spaces/.orden/Notes/Notes'])
  })

  test('made twice, the first one changed since, still only the bare copy goes', async () => {
    const ws = await twinned((kept) =>
      call('write_note', { path: `${kept}/Plan.md`, content: 'ship it today' }),
    )
    expect(ws.deleted).toEqual(['s1'])
  })

  test('made twice, and the copy written in since, both stay', async () => {
    const ws = await twinned((_, twin) =>
      call('write_note', { path: `${twin}/Later.md`, content: 'read the letter' }),
    )
    expect(ws.deleted).toEqual([])
    expect(ws.spaces).toHaveLength(2)
  })

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
    expect(await call('path_exists', { path: `${root}/.obsidian/app.json` })).toBe(true)
    expect(await call('path_exists', { path: `${root}/.obsidian/plugins.json` })).toBe(false)
    expect(disk.rehomed).toEqual([`/spaces/Notes -> ${root}`])
    for (const [path, held] of before) {
      if (path !== '/spaces/Notes/Plan.md') expect(disk.files.get(path)).toEqual(held)
    }
    expect(await call('list_spaces')).toEqual([{ name: 'Notes', path: root }])
    const backup = [...disk.dirs].find((one) => one.startsWith('/spaces/.orden/.backups/Notes '))
    expect(disk.files.get(`${backup ?? ''}/Plan.md`)).toBe('ship it')
    expect(disk.files.get(`${backup ?? ''}/Work/cat.png`)).toEqual(new Uint8Array([1, 2]))

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
      if (command === 'write_bytes' && String(args.path).includes('/.entries/')) {
        return write(command, { ...args, bytes: Uint8Array.of(0) })
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

  test('is converted whatever this device has stored, one an older build turned back too', async () => {
    const { convertAll } = await import('./convert')
    for (const stored of [null, 'off', 'on']) {
      if (stored === null) localStorage.removeItem('orden:keep-spaces')
      else localStorage.setItem('orden:keep-spaces', stored)
      const name = `Notes ${String(stored)}`
      disk.dirs.add(`/spaces/${name}`)
      disk.files.set(`/spaces/${name}/Plan.md`, 'ship it')
      disk.dirs.add('/spaces/.orden')
      disk.files.set('/spaces/.orden/.folders', `/spaces/${name}\n`)
      const { ws, said } = workspace([`/spaces/${name}`])
      await convertAll(ws)
      const root = `/spaces/.orden/${name}/${name}`
      expect(said).toEqual([`space /spaces/${name} -> ${root}`])
      expect(await call('read_note', { path: `${root}/Plan.md` })).toBe('ship it')
    }
    expect((await call<{ path: string }[]>('list_spaces')).map((one) => one.path)).toEqual([
      '/spaces/.orden/Notes null/Notes null',
      '/spaces/.orden/Notes off/Notes off',
      '/spaces/.orden/Notes on/Notes on',
    ])
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

describe("a space written out keeps each note's own metadata (#1210)", () => {
  test("writes a note's icon and cover back as front matter, and leaves the rest as it is", async () => {
    const { exportSpaceTo } = await import('./export')
    disk.dirs.add('/spaces/Disk')
    disk.dirs.add('/spaces/Disk/Work')
    disk.files.set('/spaces/Disk/Work/Plan.md', '# Plan\n')
    disk.files.set('/spaces/Disk/Bare.md', 'words\n')
    disk.files.set('/spaces/Disk/cat.png', 'AQI=')
    const meta: Record<string, Record<string, string>> = {
      'Work/Plan.md': { icon: 'rocket', 'icon-color': 'red', cover: 'cat.png' },
      'cat.png': { icon: 'ignored' },
    }

    await exportSpaceTo('/spaces/Disk', 'Disk', '/picked', (path) => meta[path] ?? null)
    const read = (path: string) => new TextDecoder().decode(disk.files.get(path) as Uint8Array)
    expect(read('/picked/Disk/Work/Plan.md')).toBe(
      '---\nicon: rocket\nicon-color: red\ncover: cat.png\n---\n# Plan\n',
    )
    expect(read('/picked/Disk/Bare.md')).toBe('words\n')
  })
})

describe('a space written out keeps which notes are todo lists (#1344)', () => {
  test("writes a list's mark and its todos' done days, and a stopped list's mark", async () => {
    const { exportSpaceTo } = await import('./export')
    const { taskHash } = await import('@orden/bases')
    const { datesText, DONE_KEY } = await import('@orden/bases/todo-lists')
    disk.dirs.add('/spaces/Disk')
    disk.dirs.add('/spaces/Disk/Projects')
    disk.files.set('/spaces/Disk/Projects/Errands.md', '- [x] Post it\n')
    disk.files.set('/spaces/Disk/Old.md', '- [ ] Call Sam\n')
    disk.files.set('/spaces/Disk/Bare.md', '- [x] Read\n')
    const meta: Record<string, Record<string, string>> = {
      'Old.md': { 'todo-list': 'no' },
      'Bare.md': { [DONE_KEY]: datesText(new Map([[taskHash('Read'), '2026-11-02']])) ?? '' },
    }
    const listed = new Map([
      ['Projects/Errands.md', datesText(new Map([[taskHash('Post it'), '2026-11-01']])) ?? ''],
    ])
    const metaOf = (path: string) => {
      const done = listed.get(path)
      return done === undefined ? (meta[path] ?? null) : { [DONE_KEY]: done }
    }

    await exportSpaceTo('/spaces/Disk', 'Disk', '/picked', metaOf, (path) => listed.has(path))
    const read = (path: string) => new TextDecoder().decode(disk.files.get(path) as Uint8Array)
    expect(read('/picked/Disk/Projects/Errands.md')).toBe(
      '---\ntodo-list: yes\n---\n- [x] Post it ✅ 2026-11-01\n',
    )
    expect(read('/picked/Disk/Old.md')).toBe('---\ntodo-list: no\n---\n- [ ] Call Sam\n')
    expect(read('/picked/Disk/Bare.md')).toBe('- [x] Read\n')
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
      deleteSpace: () => Promise.resolve(),
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

  test('cut short by a crash, is never listed half made, and goes on from where it stopped', async () => {
    const { convertAll } = await import('./convert')
    const { InternalFolder } = await import('./folder')
    const { folderBytes } = await import('./bytes')
    notes()
    disk.dirs.add('/spaces/.orden/.backups/Notes earlier')
    disk.files.set('/spaces/.orden/.backups/Notes earlier/Plan.md', 'ship it')
    const half = '/spaces/.orden/Notes'
    disk.files.set(`${half}/.converting`, '/spaces/Notes\n/spaces/.orden/.backups/Notes earlier\n')
    const world = { now: () => 1, key: () => crypto.randomUUID(), foldsCase: false }
    const before = await InternalFolder.open(half, folderBytes(half), world)
    await before.adopt('Plan.md', new TextEncoder().encode('ship it'))
    await before.adopt('Work/Old.md', new TextEncoder().encode('ol'))
    await before.save()
    before.close()
    expect(await call('list_spaces')).toEqual([{ name: 'Notes', path: '/spaces/Notes' }])

    const write = disk.crate
    const written: string[] = []
    disk.crate = (command, args) => {
      if (command === 'write_bytes' && String(args.path).includes('/.entries/')) {
        written.push(String(args.path))
      }
      return write(command, args)
    }
    const { ws, said } = workspace('/spaces/Notes')
    try {
      await Promise.all([convertAll(ws), convertAll(ws)])
    } finally {
      disk.crate = write
    }
    const root = '/spaces/.orden/Notes/Notes'
    expect(said).toEqual([`/spaces/Notes -> ${root}`])
    expect(written).toHaveLength(1)
    expect(disk.files.has(`${half}/.converting`)).toBe(false)
    expect(await call('read_note', { path: `${root}/Plan.md` })).toBe('ship it')
    expect(await call('read_note', { path: `${root}/Work/Old.md` })).toBe('old')
    expect(
      [...disk.dirs].filter((one) => /^\/spaces\/\.orden\/\.backups\/[^/]+$/.test(one)),
    ).toEqual(['/spaces/.orden/.backups/Notes earlier'])
  })

  test('takes a free name where Orden already keeps a space of that name', async () => {
    const { convertSpace } = await import('./convert')
    notes()
    disk.dirs.add('/spaces/.orden')
    disk.dirs.add('/spaces/.orden/Notes')
    disk.files.set('/spaces/.orden/Notes/Notes', '')
    const { ws, said } = workspace('/spaces/Notes')
    expect(await convertSpace(ws, 's0')).toBe(true)
    const root = '/spaces/.orden/Notes 2/Notes 2'
    expect(said).toEqual([`/spaces/Notes -> ${root}`])
    expect(ws.spaces[0]).toMatchObject({ name: 'Notes 2', root })
    expect(await call('read_note', { path: `${root}/Plan.md` })).toBe('ship it')
    expect(await convertSpace(ws, 's0')).toBe(false)
  })

  test('a half-made folder from an old build, with only its source named, is gone on with too', async () => {
    const { convertAll } = await import('./convert')
    notes()
    disk.dirs.add('/spaces/.orden')
    disk.dirs.add('/spaces/.orden/Notes')
    disk.files.set('/spaces/.orden/Notes/.converting', '/spaces/Notes')
    disk.files.set('/spaces/.orden/Notes/.entries/half.md', 'ship')
    const { ws, said } = workspace('/spaces/Notes')
    await convertAll(ws)
    const root = '/spaces/.orden/Notes/Notes'
    expect(said).toEqual([`/spaces/Notes -> ${root}`])
    expect(await call('read_note', { path: `${root}/Plan.md` })).toBe('ship it')
    expect([...disk.dirs].some((one) => one.startsWith('/spaces/.orden/.backups/Notes '))).toBe(
      true,
    )
  })

  test('writes its index a handful of times, not once a file', async () => {
    const { convertSpace } = await import('./convert')
    disk.dirs.add('/spaces/Big')
    for (let at = 0; at < 450; at += 1) disk.files.set(`/spaces/Big/${String(at)}.md`, String(at))
    const write = disk.crate
    let indexed = 0
    disk.crate = (command, args) => {
      if (command === 'write_note' && /\/\.index\.[01]\.json$/.test(String(args.path))) indexed += 1
      return write(command, args)
    }
    const { ws } = workspace('/spaces/Big')
    const seen: [number, number][] = []
    try {
      expect(
        await convertSpace(ws, 's0', {
          progress: (done, total) => seen.push([done, total]),
          failed: () => undefined,
        }),
      ).toBe(true)
    } finally {
      disk.crate = write
    }
    expect(indexed).toBeLessThan(10)
    expect(seen).toHaveLength(450)
    expect(seen.at(-1)).toEqual([450, 450])
    expect(await call('read_note', { path: '/spaces/.orden/Big/Big/449.md' })).toBe('449')
  })

  test('shows how far it is while it goes, and says so when a space stays a folder', async () => {
    const { convertAll } = await import('./convert')
    const { busy } = await import('../busy.svelte')
    notes()
    disk.dirs.add('/spaces/Stuck')
    disk.files.set('/spaces/Stuck/Plan.md', 'stuck')
    const write = disk.crate
    const shown: string[] = []
    disk.crate = (command, args) => {
      if (busy.told) shown.push(`${busy.label ?? ''} · ${busy.told}`)
      if (command === 'write_bytes' && String(args.path).startsWith('/spaces/.orden/Stuck/')) {
        throw new Error('No space left on device')
      }
      return write(command, args)
    }
    const notesSpace = workspace('/spaces/Notes').ws
    notesSpace.spaces.push({ id: 's1', name: 'Stuck', root: '/spaces/Stuck' })
    try {
      await convertAll(notesSpace)
    } finally {
      disk.crate = write
    }
    expect(shown).toContain('Moving Notes into Orden’s storage · 2 of 2')
    expect(busy.told).toBeNull()
    expect(busy.active).toBe(false)
    expect(busy.trouble).toContain('Stuck')
    expect(busy.trouble).not.toContain('Notes,')
    expect(notesSpace.spaces[1]?.root).toBe('/spaces/Stuck')
    expect(disk.files.get('/spaces/Stuck/Plan.md')).toBe('stuck')
    expect(disk.dirs.has('/spaces/.orden/Stuck')).toBe(false)
    busy.clear()
  })

  test('converts once when two windows ask at once', async () => {
    notes()
    const { convertAll } = await import('./convert')
    const away = './convert?window=two'
    const other = (await import(away)) as typeof import('./convert')
    expect(other.convertAll).not.toBe(convertAll)
    const one = workspace('/spaces/Notes')
    const two = workspace('/spaces/Notes')
    await Promise.all([convertAll(one.ws), other.convertAll(two.ws)])
    const root = '/spaces/.orden/Notes/Notes'
    expect([...one.said, ...two.said]).toEqual([`/spaces/Notes -> ${root}`])
    const { busy } = await import('../busy.svelte')
    expect(busy.trouble).toBeNull()
    expect(disk.files.has(root)).toBe(true)
    expect([...disk.files.keys()].filter((one) => one.includes('/.backups/'))).toHaveLength(2)
    expect(await call('list_spaces')).toEqual([{ name: 'Notes', path: root }])
    expect([...disk.dirs].filter((dir) => /^\/spaces\/\.orden\/[^/.][^/]*$/.test(dir))).toEqual([
      '/spaces/.orden/Notes',
    ])
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
})
