import { describe, expect, test } from 'vitest'
import { MemoryDisk } from './memory-disk'
import { settle, SpaceState } from './places'

/** Where the account says the entries are, put on a disk that still has them where
 *  they were. */

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
  // Sorted by where they were, the note went first, its folder was made for it at
  // the folder's new name, and the folder then found something in its way there on
  // every pass, for good: its notes went one by one and an empty folder stayed.
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
  // Renamed Old, a new Projects made, and Old moved into it: the folder at Projects
  // was asked to go into Projects/Old, inside itself, which no disk will do, and the
  // settle threw on every pass.
  test('steps aside first, and both end where they are wanted', async () => {
    const disk = new MemoryDisk()
    disk.folders.add('/r')
    disk.folders.add('/r/Projects')
    disk.files.set('/r/Projects/plan.md', 'p')
    const real = disk.move.bind(disk)
    disk.move = (from: string, to: string, kind: 'file' | 'folder') => {
      if (to.startsWith(`${from}/`)) throw new Error(`${from} cannot go inside itself`)
      return real(from, to, kind)
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
