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
  return { files, dirs, crate }
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
