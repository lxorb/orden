import { describe, expect, test, vi } from 'vitest'
import type { Entry } from '../workspace.svelte'

const { told, disk, reads } = vi.hoisted(() => ({
  reads: [] as string[],
  told: [] as string[],
  disk: new Map<string, string>(),
}))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: async (
    command: string,
    args: { from: string; to: string; path: string; content: string },
  ) => {
    if (command === 'read_note') {
      reads.push(args.path)
      return disk.get(args.path) ?? null
    }
    if (command === 'write_note') {
      disk.set(args.path, args.content)
      return void told.push(`write ${args.path}`)
    }
    told.push(`${command} ${args.from} -> ${args.to}`)
  },
}))
vi.mock('./write-file', () => ({
  copyPath: async (from: string, to: string) => {
    for (const [path, text] of [...disk]) {
      if (path === from || path.startsWith(`${from}/`)) disk.set(to + path.slice(from.length), text)
    }
    told.push(`copy ${from} -> ${to}`)
  },
  writeBytes: async () => undefined,
  writeFile: async (path: string, content: string) => void disk.set(path, content),
}))
vi.mock('../views/copied', () => ({
  numbersAt: (path: string) => path.startsWith('/s/Bugs/'),
  withoutIds: (path: string, text: string) =>
    path.startsWith('/s/Bugs/') && /^id: BUG-/m.test(text) ? text.replace(/^id: .*\n/m, '') : null,
}))

const stored = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
})

const { copyRows } = await import('./copying')
const { ItemMetaStore } = await import('./item-meta.svelte')
const { Protection } = await import('../protect/protection.svelte')

const meta = new ItemMetaStore((path) => (path?.startsWith('/t/') ? '/t' : '/s'))

const entry = (path: string, children: Entry[] = []): Entry => ({
  name: path.replace(/^.*\//, ''),
  path,
  is_dir: children.length > 0,
  modified: 0,
  created: 0,
  children,
})

function rig(entries: Entry[]) {
  told.length = 0
  reads.length = 0
  return {
    undone: { record: () => undefined },
    itemMeta: meta,
    protection: { copied: () => undefined },
    rootHolding: () => '/s',
    entryAt: (path: string) => entries.find((one) => one.path === path) ?? null,
    showEntry: () => undefined,
    freshEntry: (path: string) => entry(path),
    freeNameOnDisk: async (_dir: string, wanted: string) => (wanted === 'Trip' ? 'Trip x' : wanted),
    fileMoved: async (from: string, to: string) => void told.push(`moved ${from} -> ${to}`),
    fileCame: async (path: string) => void told.push(`came ${path}`),
    pageNoteForPdf: async () => null,
  }
}

describe('a copied folder note', () => {
  test('is renamed before the copy is told, and is never told as a move', async () => {
    disk.clear()
    disk.set('/s/Trip/Trip.md', '# Trip\n')
    const ws = rig([entry('/s/Trip', [entry('/s/Trip/Trip.md')])])
    await copyRows(ws as never, [{ from: '/s/Trip', into: '/s' }])

    expect(reads).toEqual([])
    expect(told).toEqual([
      'copy /s/Trip -> /s/Trip copy',
      'rename_note /s/Trip copy/Trip.md -> /s/Trip copy/Trip copy.md',
      'came /s/Trip copy',
    ])
  })
})

describe('a copied note in a base that numbers its rows', () => {
  test('comes without the id, so the original keeps it', async () => {
    disk.clear()
    disk.set('/s/Bugs/A.md', '---\nid: BUG-2\nstatus: Doing\n---\nText\n')
    const ws = rig([entry('/s/Bugs/A.md')])
    await copyRows(ws as never, [{ from: '/s/Bugs/A.md', into: '/s/Bugs/2025' }])

    expect(told).toEqual([
      'copy /s/Bugs/A.md -> /s/Bugs/2025/A.md',
      'write /s/Bugs/2025/A.md',
      'came /s/Bugs/2025/A.md',
    ])
    expect(disk.get('/s/Bugs/2025/A.md')).toBe('---\nstatus: Doing\n---\nText\n')
    expect(disk.get('/s/Bugs/A.md')).toContain('id: BUG-2')
  })

  test('and every note of a copied folder does too', async () => {
    disk.clear()
    disk.set('/s/Bugs/Sprint/X.md', '---\nid: BUG-3\n---\n')
    disk.set('/s/Bugs/Sprint/Deep/Y.md', '---\nid: BUG-4\n---\n')
    const ws = rig([
      entry('/s/Bugs/Sprint', [
        entry('/s/Bugs/Sprint/X.md'),
        entry('/s/Bugs/Sprint/Deep', [entry('/s/Bugs/Sprint/Deep/Y.md')]),
      ]),
    ])
    await copyRows(ws as never, [{ from: '/s/Bugs/Sprint', into: '/s/Bugs/2025' }])

    expect(disk.get('/s/Bugs/2025/Sprint/X.md')).not.toContain('BUG')
    expect(disk.get('/s/Bugs/2025/Sprint/Deep/Y.md')).not.toContain('BUG')
    expect(told.at(-1)).toBe('came /s/Bugs/2025/Sprint')
  })
})

describe('a copy keeps what Orden keeps about the item', () => {
  test('a copied note keeps its metadata, icon and all', async () => {
    disk.clear()
    disk.set('/s/Groceries.md', '- [x] Milk\n')
    meta.set('/s/Groceries.md', { 'todo-list': 'yes', icon: 'cart', 'done-on': 'abc:20261101' })
    const ws = rig([entry('/s/Groceries.md')])
    await copyRows(ws as never, [{ from: '/s/Groceries.md', into: '/s/Old' }])

    expect(meta.of('/s/Old/Groceries.md')).toEqual({
      'todo-list': 'yes',
      icon: 'cart',
      'done-on': 'abc:20261101',
    })
    expect(meta.of('/s/Groceries.md')).toEqual({
      'todo-list': 'yes',
      icon: 'cart',
      'done-on': 'abc:20261101',
    })
  })

  test('every note of a copied folder keeps its own, the renamed folder note too', async () => {
    disk.clear()
    disk.set('/s/Trip/Trip.md', '# Trip\n')
    disk.set('/s/Trip/Packing.md', '- [ ] Socks\n')
    meta.set('/s/Trip', { icon: 'plane' })
    meta.set('/s/Trip/Trip.md', { cover: 'sea' })
    meta.set('/s/Trip/Packing.md', { 'todo-list': 'yes' })
    const ws = rig([entry('/s/Trip', [entry('/s/Trip/Trip.md'), entry('/s/Trip/Packing.md')])])
    await copyRows(ws as never, [{ from: '/s/Trip', into: '/s' }])

    expect(meta.of('/s/Trip copy')).toEqual({ icon: 'plane' })
    expect(meta.of('/s/Trip copy/Trip copy.md')).toEqual({ cover: 'sea' })
    expect(meta.of('/s/Trip copy/Trip.md')).toBeNull()
    expect(meta.of('/s/Trip copy/Packing.md')).toEqual({ 'todo-list': 'yes' })
    expect(meta.of('/s/Trip/Trip.md')).toEqual({ cover: 'sea' })
  })

  test('a note copied into another space takes it there', async () => {
    disk.clear()
    disk.set('/s/Plan.md', '- [ ] Call\n')
    meta.set('/s/Plan.md', { 'todo-list': 'yes' })
    const ws = rig([entry('/s/Plan.md')])
    await copyRows(ws as never, [{ from: '/s/Plan.md', into: '/t' }])

    expect(meta.of('/t/Plan.md', '/t')).toEqual({ 'todo-list': 'yes' })
  })

  test('a protected note copied leaves a copy that is as protected', async () => {
    disk.clear()
    disk.set('/s/Diary.md', 'what nobody may read\n')
    const ws = rig([entry('/s/Diary.md')])
    const protection = new Protection()
    protection.set('/s', '/s/Diary.md', 'password')
    await copyRows(
      {
        ...ws,
        protection,
        rootHolding: (path: string | null) => (path?.startsWith('/t/') ? '/t' : '/s'),
      } as never,
      [{ from: '/s/Diary.md', into: '/t' }],
    )

    expect(protection.covering('/t/Diary.md')).toEqual([
      { root: '/t', key: 'Diary.md', way: 'password' },
    ])
  })
})
