import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))
vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: false,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))
const { Disk } = await import('../disk')
disk.current = new Disk()
const { workspace } = await import('../../src/lib/workspace/src/api')
const Tree = (await import('../../src/lib/sidebar/src/Tree.svelte')).default
const A = '/space/A'
const B = '/space/B'
let list: ReturnType<typeof mount> | null = null
const order = () => [...document.querySelectorAll<HTMLElement>('.row[data-path]')].map((row) => row.dataset.path)
afterEach(() => {
  if (list) void unmount(list)
  list = null
  vi.unstubAllGlobals()
})
test('a folder opened while another still slides shut shows the rows as they are now', async () => {
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
  HTMLElement.prototype.scrollIntoView = () => undefined
  const one = disk.current!
  for (const path of [`${A}/a1.md`, `${A}/a2.md`, `${B}/b1.md`]) one.files.set(path, '# Note\n')
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  if (!workspace.isExpanded(A)) workspace.toggleFolder(A)
  if (workspace.isExpanded(B)) workspace.toggleFolder(B)
  await workspace.loadTree()
  list = mount(Tree, {
    target: document.body,
    props: {
      get tree() {
        return workspace.tree!
      },
    },
  })
  flushSync()
  expect(order()).toEqual([A, `${A}/a1.md`, `${A}/a2.md`, B])
  workspace.toggleFolder(A)
  flushSync()
  workspace.toggleFolder(B)
  flushSync()
  expect(order()).toEqual([A, B])
})
