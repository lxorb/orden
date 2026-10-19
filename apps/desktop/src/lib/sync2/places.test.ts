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
