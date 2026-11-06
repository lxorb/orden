import { describe, expect, test } from 'vitest'
import { MemoryDisk } from './memory-disk'
import { settle, SpaceState } from './places'

const row = (id: string, kind: string, parent: string | null, name: string, local: string) => ({
  id,
  space_id: 's',
  kind,
  parent,
  name,
  local_path: local,
  file_key: null,
  written_hash: null,
  mtime: null,
  size: null,
  seq: 1,
  deleted: false,
})

describe('a folder renamed while a note was moved into it', () => {
  test.each(['the note first', 'the folder first'])(
    'goes to its new name whole, with the note in it, listed %s',
    async (order) => {
      const disk = new MemoryDisk()
      disk.folders.add('/r')
      disk.folders.add('/r/B')
      disk.files.set('/r/B/in.md', 'x')
      disk.files.set('/r/N.md', 'n')
      const folder = row('X', 'folder', null, 'A', 'B')
      const inside = row('I', 'note', 'X', 'in.md', 'B/in.md')
      const note = row('N', 'note', 'X', 'N.md', 'N.md')
      const entries = order === 'the note first' ? [note, folder, inside] : [folder, note, inside]
      const space = new SpaceState(
        { space_id: 's', root: '/r', cursor: 9, role: 'owner', store: null },
        entries,
        [],
        'd',
        { platform: 'linux', foldsCase: true } as never,
      )
      const how = {
        disk,
        join: (a: string, b: string) => `${a}/${b}`,
        keeps: () => false,
        forget: () => undefined,
      }

      await settle(space, how)

      expect([folder.local_path, note.local_path, inside.local_path]).toEqual([
        'A',
        'A/N.md',
        'A/in.md',
      ])
      expect(disk.folders.has('/r/B')).toBe(false)
      expect([...disk.files.keys()].sort()).toEqual(['/r/A/N.md', '/r/A/in.md'])
    },
  )
})

describe('a folder moved into a new folder that took its old name', () => {
  test('steps aside first, and both end where they are wanted', async () => {
    const disk = new MemoryDisk()
    disk.folders.add('/r')
    disk.folders.add('/r/Projects')
    disk.files.set('/r/Projects/plan.md', 'p')
    const real = disk.move.bind(disk)
    disk.move = (from: string, to: string) => {
      if (to.startsWith(`${from}/`)) throw new Error(`${from} cannot go inside itself`)
      return real(from, to)
    }
    const fresh = row('P', 'folder', null, 'Projects', '')
    const old = row('O', 'folder', 'P', 'Old', 'Projects')
    const plan = row('N', 'note', 'O', 'plan.md', 'Projects/plan.md')
    const space = new SpaceState(
      { space_id: 's', root: '/r', cursor: 9, role: 'owner', store: null },
      [fresh, old, plan],
      [],
      'd',
      { platform: 'linux', foldsCase: true } as never,
    )

    await settle(space, {
      disk,
      join: (a: string, b: string) => `${a}/${b}`,
      keeps: () => false,
      forget: () => undefined,
    })

    expect([fresh.local_path, old.local_path, plan.local_path]).toEqual([
      'Projects',
      'Projects/Old',
      'Projects/Old/plan.md',
    ])
    expect([...disk.files.keys()]).toEqual(['/r/Projects/Old/plan.md'])
    expect([...disk.folders].filter((one) => one.includes('.nib-moving'))).toEqual([])
  })
})

describe('a move the disk refuses', () => {
  test('leaves that file where it is and settles the rest', async () => {
    const disk = new MemoryDisk()
    disk.folders.add('/r')
    disk.files.set('/r/X.pdf', 'p')
    disk.files.set('/r/a.md', 'a')
    const real = disk.move.bind(disk)
    disk.move = (from: string, to: string) => {
      if (from === '/r/X.pdf') throw new Error('/r/X.pages is already there')
      return real(from, to)
    }
    const pdf = row('P', 'file', null, 'X.pages.pdf', 'X.pdf')
    const note = row('N', 'note', null, 'b.md', 'a.md')
    const space = new SpaceState(
      { space_id: 's', root: '/r', cursor: 9, role: 'owner', store: null },
      [pdf, note],
      [],
      'd',
      { platform: 'linux', foldsCase: true } as never,
    )

    await settle(space, {
      disk,
      join: (a: string, b: string) => `${a}/${b}`,
      keeps: () => false,
      forget: () => undefined,
    })

    expect([pdf.local_path, note.local_path]).toEqual(['X.pdf', 'b.md'])
    expect([...disk.files.keys()].sort()).toEqual(['/r/X.pdf', '/r/b.md'])
  })
})

describe('a delete or a new folder the disk refuses', () => {
  test('leaves that file where it is and settles the rest', async () => {
    const disk = new MemoryDisk()
    disk.folders.add('/r')
    disk.files.set('/r/X.pdf', 'p')
    disk.files.set('/r/a.md', 'a')
    const real = disk.remove.bind(disk)
    disk.remove = (path: string) => {
      if (path === '/r/X.pdf') throw new Error('/r/X.pdf is open in another program')
      return real(path)
    }
    const pdf = { ...row('P', 'file', null, 'X.pdf', 'X.pdf'), deleted: true }
    const note = row('N', 'note', null, 'b.md', 'a.md')
    const forgotten: string[] = []
    const space = new SpaceState(
      { space_id: 's', root: '/r', cursor: 9, role: 'owner', store: null },
      [pdf, note],
      [],
      'd',
      { platform: 'linux', foldsCase: true } as never,
    )

    await settle(space, {
      disk,
      join: (a: string, b: string) => `${a}/${b}`,
      keeps: () => false,
      forget: (id) => forgotten.push(id),
    })

    expect([pdf.local_path, note.local_path]).toEqual(['X.pdf', 'b.md'])
    expect(forgotten).toEqual([])
    expect([...disk.files.keys()].sort()).toEqual(['/r/X.pdf', '/r/b.md'])
  })

  test('a folder it cannot make waits, with what goes in it, and the rest settles', async () => {
    const disk = new MemoryDisk()
    disk.folders.add('/r')
    disk.files.set('/r/a.md', 'a')
    disk.files.set('/r/c.md', 'c')
    const real = disk.mkdir.bind(disk)
    disk.mkdir = (path: string) => {
      if (path === '/r/F') throw new Error('/r/F may not be made')
      return real(path)
    }
    const folder = row('F', 'folder', null, 'F', '')
    const into = row('A', 'note', 'F', 'a.md', 'a.md')
    const other = row('C', 'note', null, 'd.md', 'c.md')
    const space = new SpaceState(
      { space_id: 's', root: '/r', cursor: 9, role: 'owner', store: null },
      [folder, into, other],
      [],
      'd',
      { platform: 'linux', foldsCase: true } as never,
    )

    await settle(space, {
      disk,
      join: (a: string, b: string) => `${a}/${b}`,
      keeps: () => false,
      forget: () => undefined,
    })

    expect([folder.local_path, into.local_path, other.local_path]).toEqual(['', 'a.md', 'd.md'])
    expect([...disk.files.keys()].sort()).toEqual(['/r/a.md', '/r/d.md'])
  })
})

describe('a file waiting aside', () => {
  test.each(['../../Private/AGENTS.md', '..\\..\\Private\\AGENTS.md', 'C:evil', 'plain'])(
    'stays in its folder whatever its id is: %s',
    async (id) => {
      const disk = new MemoryDisk()
      disk.folders.add('/spaces/Shared')
      disk.files.set('/spaces/Shared/a.md', 'planted')
      disk.files.set('/spaces/Shared/c.md', 'other')
      const moves: string[] = []
      const move = disk.move.bind(disk)
      disk.move = (from, to) => {
        moves.push(to)
        return move(from, to)
      }
      const mkdir = disk.mkdir.bind(disk)
      disk.mkdir = (path) => (path.includes('a:b') ? Promise.reject(new Error('no')) : mkdir(path))
      const holder = row(id, 'note', 'F', 'b.md', 'a.md')
      const mover = row('E', 'note', null, 'a.md', 'c.md')
      const folder = row('F', 'folder', null, 'a:b', '')
      const space = new SpaceState(
        { space_id: 's', root: '/spaces/Shared', cursor: 9, role: 'write', store: null },
        [mover, holder, folder],
        [],
        'd',
        { platform: 'other', foldsCase: false } as never,
      )

      await settle(space, {
        disk,
        join: (a: string, b: string) => `${a}/${b}`,
        keeps: () => false,
        forget: () => undefined,
      })

      const waiting = moves.find((to) => to.includes('.nib-moving-'))
      expect(waiting).toMatch(/^\/spaces\/Shared\/\.nib-moving-[a-z0-9]+$/)
      expect(holder.local_path).toMatch(/^\.nib-moving-[a-z0-9]+$/)
    },
  )
})

describe('what a space holds at a path', () => {
  test('is found as a walk of every entry finds it, through any change to the entries', () => {
    let seed = 7
    const random = (most: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % most
    }
    const names = ['a.md', 'A.md', 'b.md', 'Ä.md', 'Ä.md', 'f/a.md', 'F/A.md', '']
    const space = new SpaceState(
      { space_id: 's', root: '/r', cursor: 9, role: 'owner', store: null },
      [],
      [],
      'd',
      { platform: 'linux', foldsCase: true } as never,
    )
    const walked = (path: string) => {
      const wanted = space.key(path)
      for (const entry of space.entries.values()) {
        if (entry.local_path && space.key(entry.local_path) === wanted) return entry
      }
      return null
    }
    for (let step = 0; step < 3000; step++) {
      const id = `e${String(random(12))}`
      const name = names[random(names.length)] ?? ''
      const held = space.entries.get(id)
      const what = random(4)
      if (what === 0) space.entries.delete(id)
      else if (what === 1 || !held) space.entries.set(id, row(id, 'note', null, 'x.md', name))
      else held.local_path = name
      for (const path of names.filter(Boolean)) {
        expect(space.at(path)?.id ?? null).toBe(walked(path)?.id ?? null)
      }
    }
  })
})
