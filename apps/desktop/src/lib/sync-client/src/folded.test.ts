import { describe, expect, test } from 'vitest'
import { foldedInto } from './folded'
import { MemoryDisk } from './memory-disk'
import { settleDisk } from './pass'
import { SpaceState } from './places'
import type { EntryRow } from './store'

const ROOT = '/r'
function row(
  id: string,
  kind: string,
  parent: string | null,
  name: string,
  local: string,
  seq: number | null,
): EntryRow {
  const at = { file_key: null, written_hash: null, mtime: null, size: null, deleted: false }
  return { id, space_id: 's', kind, parent, name, local_path: local, seq, ...at }
}
async function folded(extra: string[] = []) {
  const disk = new MemoryDisk()
  for (const folder of [ROOT, `${ROOT}/Ideas`, `${ROOT}/Ideas 2`]) disk.folders.add(folder)
  await disk.write(`${ROOT}/Ideas 2/a.md`, '# a\n')
  for (const path of extra) await disk.write(`${ROOT}/Ideas 2/${path}`, 'kept\n')
  const rows = [
    row('t', 'folder', null, 'Ideas', 'Ideas', 1),
    row('m', 'folder', null, 'Ideas', 'Ideas 2', null),
    row('c', 'note', 'm', 'a.md', 'Ideas 2/a.md', 1),
  ]
  const space = new SpaceState({ space_id: 's', root: ROOT, cursor: 9, role: 'owner', store: null }, rows, [], 'd', {
    platform: 'linux',
    foldsCase: false,
  } as never)
  foldedInto(space, 'm', 't')
  const core = {
    hasPending: () => false,
    isHeld: () => false,
    touched: new Set<string>(),
    inHand: new Map<string, number>(),
    forgetChanges: () => [],
    entryChanges: () => [],
    commit: () => Promise.resolve(),
    events: {},
    world: { disk, join: (root: string, path: string) => `${root}/${path}` },
  }
  await settleDisk(core as never, space, true)
  return { disk, space }
}
describe('a folder folded into one of its name already on this disk (#2348)', () => {
  test('hands its notes over and goes once nothing is left in it', async () => {
    const { disk, space } = await folded()
    expect(space.entries.get('c')?.local_path).toBe('Ideas/a.md')
    expect(disk.files.get(`${ROOT}/Ideas/a.md`)).toBe('# a\n')
    expect(disk.folders.has(`${ROOT}/Ideas 2`)).toBe(false)
    expect(disk.folders.has(`${ROOT}/Ideas`)).toBe(true)
  })
  test('stays while it still holds a file, a hidden one too', async () => {
    const { disk } = await folded(['.keep'])
    expect(disk.folders.has(`${ROOT}/Ideas 2`)).toBe(true)
    expect(disk.files.get(`${ROOT}/Ideas 2/.keep`)).toBe('kept\n')
    expect(disk.files.get(`${ROOT}/Ideas/a.md`)).toBe('# a\n')
  })
})
