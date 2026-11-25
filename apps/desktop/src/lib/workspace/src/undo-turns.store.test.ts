import { beforeEach, expect, test, vi } from 'vitest'

const held = vi.hoisted(() => ({
  disk: null as import('../../../../test/disk').Disk | null,
  trash: new Map<string, { root: string; files: [string, string][]; folders: string[] }>(),
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
      const files = [...d.files].filter(([one]) => under(one))
      const folders = [...d.folders].filter(under)
      held.trash.set(id, { root: path, files, folders })
      await new Promise((go) => setTimeout(go, 40))
      for (const [one] of files) d.files.delete(one)
      for (const one of folders) d.folders.delete(one)
      return { id }
    }
    if (command === 'restore_trash' && held.trash.has(String(args?.id))) {
      const kept = held.trash.get(String(args?.id))!
      for (const one of kept.folders) d.folders.add(one)
      for (const [one, words] of kept.files) d.files.set(one, words)
      held.trash.delete(String(args?.id))
      return kept.root
    }
    return d.invoke(command, args)
  },
}))
const { Disk, memoryStorage } = await import('../../../../test/disk')
held.disk = new Disk()
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('./workspace.svelte')
const d = held.disk
const NOTES = Array.from({ length: 30 }, (_, at) => `/s/Big/n${String(at)}.md`)
beforeEach(async () => {
  await workspace.writesSettled()
  d.reset()
  held.trash.clear()
  d.folders.add('/s').add('/s/Big')
  for (const path of NOTES) d.files.set(path, `# ${path}\n`)
  d.files.set('/s/keep.md', 'plain words\n')
  for (const tab of [...workspace.tabs]) workspace.close(tab.id, false)
  workspace.undone.stack = []
  workspace.undone.ahead = []
  workspace.spaces = [{ id: 'S', name: 's', root: '/s' }]
  workspace.activeSpaceId = 'S'
  await workspace.loadTree()
})
const back = () => NOTES.every((path) => d.files.get(path) === `# ${path}\n`)
test('Ctrl+Z pressed right after a folder delete starts puts the folder back, and leaves the step before it alone', async () => {
  await workspace.rename('/s/keep.md', 'kept.md')
  const deleting = workspace.remove('/s/Big', true)
  const undoing = workspace.undoFileAction()
  await Promise.all([deleting, undoing])
  expect(back()).toBe(true)
  expect(d.files.has('/s/kept.md')).toBe(true)
  expect(workspace.undone.stack.map((one) => one.kind)).toEqual(['rename'])
})
test('a burst of Ctrl+Z and Ctrl+Shift+Z ends where the last press says, with every note once', async () => {
  const going = [
    workspace.remove('/s/Big', true),
    workspace.undoFileAction(),
    workspace.redoFileAction(),
    workspace.undoFileAction(),
    workspace.undoFileAction(),
    workspace.redoFileAction(),
    workspace.undoFileAction(),
  ]
  await Promise.all(going)
  expect(back()).toBe(true)
  expect([...d.files.keys()].filter((path) => / \d+\.md$/.test(path))).toEqual([])
  expect(workspace.undone.ahead.map((one) => one.kind)).toEqual(['delete'])
})
test('two things done at once are two steps to undo', async () => {
  await Promise.all([workspace.remove('/s/Big', true), workspace.rename('/s/keep.md', 'kept.md')])
  expect(workspace.undone.stack.map((one) => one.kind)).toEqual(['delete', 'rename'])
  await workspace.undoFileAction()
  expect(d.files.has('/s/keep.md')).toBe(true)
  expect(d.folders.has('/s/Big')).toBe(false)
})
test('the tabs a folder delete closed open again when it is undone', async () => {
  await workspace.openEntry(NOTES[3]!)
  await workspace.remove('/s/Big', true)
  expect(workspace.tabs.some((tab) => tab.path === NOTES[3])).toBe(false)
  await workspace.undoFileAction()
  expect(workspace.tabs.some((tab) => tab.path === NOTES[3])).toBe(true)
})
