import { expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../../../../test/disk').Disk | null }))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const d = disk.current!
    if (command === 'path_exists') return d.files.has(String(args?.path)) || d.folders.has(String(args?.path))
    if (command === 'copy_path') {
      d.files.set(String(args?.to), d.files.get(String(args?.from)) ?? '')
      return undefined
    }
    if (command !== 'scan_links') return d.invoke(command, args)
    const { scanNote } = await import('@orden/scan/note')
    const root = `${typeof args?.root === 'string' ? args.root : '/s'}/`
    const held = [...d.files].filter(([path]) => path.startsWith(root))
    return {
      notes: held
        .filter(([path]) => path.endsWith('.md'))
        .map(([path, text]) => scanNote(path.slice(root.length), text)),
      files: held.filter(([path]) => !path.endsWith('.md')).map(([path]) => path.slice(root.length)),
    }
  },
}))
const { Disk, memoryStorage } = await import('../../../../test/disk')
const d = new Disk()
disk.current = d
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('./workspace.svelte')
const { startup } = await import('../../launch/src/api')
void startup.shown()
const PLAN = '![](../assets/a.png)\n'
test('a note moved to another space takes the pictures it shows along, and one undo puts its words back', async () => {
  d.folders.add('/s').add('/s/Work').add('/s/assets').add('/t')
  d.files.set('/s/Work/Plan.md', PLAN)
  d.files.set('/s/assets/a.png', 'PNG')
  workspace.spaces = [
    { id: 'S', name: 's', root: '/s' },
    { id: 'T', name: 't', root: '/t' },
  ]
  workspace.activeSpaceId = 'S'
  await workspace.loadTree()
  const { links } = await import('../../link-index/src/api')
  await vi.waitFor(() =>
    expect(links.reachedOf('/s/Work/Plan.md', { kind: 'markdown', target: '../assets/a.png' } as never)).not.toBeNull(),
  )
  await workspace.move('/s/Work/Plan.md', '/t')
  expect(d.files.get('/t/assets/a.png')).toBe('PNG')
  expect(d.files.get('/s/assets/a.png')).toBe('PNG')
  expect(d.files.get('/t/Plan.md')).toBe('![](assets/a.png)\n')
  await workspace.undoFileAction()
  expect(d.files.get('/s/Work/Plan.md')).toBe(PLAN)
  expect(d.files.has('/t/Plan.md')).toBe(false)
})
