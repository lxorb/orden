import { beforeEach, expect, test, vi } from 'vitest'

const held = vi.hoisted(() => ({
  disk: null as import('../../../../test/disk').Disk | null,
  trash: new Map<string, { root: string; files: [string, string][]; folders: string[] }>(),
  binned: [] as string[],
}))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const d = held.disk!
    const path = typeof args?.path === 'string' ? args.path : ''
    if (command === 'list_spaces') return [{ name: 's', path: '/s' }]
    if (command === 'trash_item' && args?.kind === 'folder') {
      const under = (one: string) => one === path || one.startsWith(`${path}/`)
      const id = `folder-${String(held.trash.size + 1)}`
      held.trash.set(id, {
        root: path,
        files: [...d.files].filter(([one]) => under(one)),
        folders: [...d.folders].filter(under),
      })
      for (const [one] of held.trash.get(id)!.files) d.files.delete(one)
      for (const one of held.trash.get(id)!.folders) d.folders.delete(one)
      held.binned.push(path)
      return { id }
    }
    if (command === 'restore_trash' && held.trash.has(String(args?.id))) {
      const kept = held.trash.get(String(args?.id))!
      for (const one of kept.folders) d.folders.add(one)
      for (const [one, words] of kept.files) d.files.set(one, words)
      held.trash.delete(String(args?.id))
      return kept.root
    }
    if (command === 'trash_item') held.binned.push(path)
    return d.invoke(command, args)
  },
}))
const { Disk, memoryStorage } = await import('../../../../test/disk')
held.disk = new Disk()
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('./workspace.svelte')
const d = held.disk
beforeEach(async () => {
  await workspace.writesSettled()
  d.reset()
  held.trash.clear()
  held.binned.length = 0
  d.folders.add('/s').add('/s/A').add('/s/B')
  d.files.set('/s/A/only.md', '# only\n')
  d.files.set('/s/B/one.md', '# one\n')
  d.files.set('/s/B/two.md', '# two\n')
  d.files.set('/s/top.md', '# top\n')
  workspace.undone.stack = []
  workspace.spaces = [{ id: 'S', name: 's', root: '/s' }]
  workspace.activeSpaceId = 'S'
  await workspace.loadTree()
})
test('the last thing in a folder deleted takes the folder along, and one undo brings both back', async () => {
  await workspace.remove('/s/A/only.md', false)
  expect(held.binned).toEqual(['/s/A'])
  expect(d.folders.has('/s/A')).toBe(false)
  expect(d.files.has('/s/A/only.md')).toBe(false)
  await workspace.undoFileAction()
  expect(d.folders.has('/s/A')).toBe(true)
  expect(d.files.get('/s/A/only.md')).toBe('# only\n')
})
test('a folder with something left in it stays, and the space itself is never taken', async () => {
  await workspace.remove('/s/B/one.md', false)
  expect(held.binned).toEqual(['/s/B/one.md'])
  expect(d.folders.has('/s/B')).toBe(true)
  await workspace.remove('/s/top.md', false)
  expect(d.folders.has('/s')).toBe(true)
})
test('every visible thing of a folder deleted together goes as the folder, once', async () => {
  await workspace.removeMany(['/s/B/one.md', '/s/B/two.md'])
  expect(held.binned).toEqual(['/s/B'])
  expect(d.folders.has('/s/B')).toBe(false)
})
