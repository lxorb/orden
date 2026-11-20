import { flushSync } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const held = vi.hoisted(() => ({ disk: null as import('../../../../test/disk').Disk | null, refuse: false }))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_spaces') return [{ name: 'Work', path: '/spaces/Work' }]
    if (command === 'rename_note' && held.refuse) throw new Error('the disk said no')
    return held.disk?.invoke(command, args)
  },
}))
const { Disk, memoryStorage } = await import('../../../../test/disk')
held.disk = new Disk()
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('./workspace.svelte')
const { flatRows } = await import('../../tree/src/api')
const { seen } = await import('../test/seen.svelte')
const ROOT = '/spaces/Work'
const at = (name: string) => `${ROOT}/${name}`
const rows = () => flatRows(workspace.shownTree, (path) => workspace.isExpanded(path)).map((row) => row.entry.path)
async function watched(names: readonly string[], run: () => Promise<unknown>) {
  const watching = seen(() => {
    const now = rows()
    return names.map((name) => now.indexOf(at(name)))
  })
  try {
    await run()
    flushSync()
  } finally {
    watching.stop()
  }
  return watching.values.map((one) => one.join(' '))
}
const once = (spots: readonly string[]) => [...new Set(spots)]
beforeEach(async () => {
  const disk = held.disk!
  disk.reset()
  held.refuse = false
  disk.folders.add(ROOT).add(at('Box'))
  for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta']) disk.files.set(at(`${name}.md`), `# ${name}\n`)
  disk.files.set(at('Box/Inner.md'), '# Inner\n')
  workspace.spaces = [{ id: 'work', name: 'Work', root: ROOT }]
  workspace.activeSpaceId = 'work'
  workspace.setSort('name')
  await workspace.loadTree()
  flushSync()
})
describe('a renamed row', () => {
  test('in a hand-made order stays in its place, never passing by the bottom', async () => {
    workspace.setSort('manual')
    workspace.arranged.set(ROOT, ['Delta.md', 'Charlie.md', 'Box', 'Bravo.md', 'Alpha.md'])
    flushSync()
    const start = rows().indexOf(at('Charlie.md'))
    const spots = await watched(['Charlie.md', 'Charlie2.md'], () => workspace.rename(at('Charlie.md'), 'Charlie2.md'))
    expect(once(spots)).toEqual([`${String(start)} -1`, `-1 ${String(start)}`])
  })
  test('of an open folder keeps the folder open and its notes listed', async () => {
    workspace.toggleFolder(at('Box'))
    flushSync()
    const spots = await watched(['Box/Inner.md', 'Crate/Inner.md'], () => workspace.rename(at('Box'), 'Crate'))
    expect(spots.every((one) => one.split(' ').some((spot) => spot !== '-1'))).toBe(true)
  })
  test('heard from another device moves once, the tree and its order together', async () => {
    workspace.setSort('manual')
    workspace.arranged.set(ROOT, ['Delta.md', 'Charlie.md', 'Box', 'Bravo.md', 'Alpha.md'])
    flushSync()
    const start = rows().indexOf(at('Charlie.md'))
    const spots = await watched(['Charlie.md', 'Charlie2.md'], async () => {
      await held.disk!.invoke('rename_note', { from: at('Charlie.md'), to: at('Charlie2.md') })
      await workspace.fileMoved(at('Charlie.md'), at('Charlie2.md'), 'file')
      workspace.heardMove(at('Charlie.md'), at('Charlie2.md'))
    })
    expect(once(spots)).toEqual([`${String(start)} -1`, `-1 ${String(start)}`])
  })
  test('whose rename the disk refused goes back, and never shows its new name out of place', async () => {
    workspace.setSort('manual')
    workspace.arranged.set(ROOT, ['Delta.md', 'Charlie.md', 'Box', 'Bravo.md', 'Alpha.md'])
    flushSync()
    const start = rows().indexOf(at('Charlie.md'))
    held.refuse = true
    const spots = await watched(['Charlie.md', 'Charlie2.md'], () =>
      workspace.rename(at('Charlie.md'), 'Charlie2.md').catch(() => undefined),
    )
    expect(once(spots).every((one) => one.split(' ').includes(String(start)))).toBe(true)
    expect(rows().indexOf(at('Charlie.md'))).toBe(start)
    expect(workspace.arranged.listOf(ROOT)).toContain('Charlie.md')
  })
})
