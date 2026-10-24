import { expect, test, vi } from 'vitest'

/** A canvas or a page note left open at quit whose file stopped reading while nib was
 *  closed - a stray comma from another editor, a copy cut short - is not put back as a
 *  blank plane: the first stroke on it would be the end of what the file held. The same
 *  refusal its open gives it (#534). Two runs of the store, the second a fresh import
 *  of every module, the way a relaunch reads what the first wrote. */

vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))
vi.stubGlobal('requestIdleCallback', (run: () => void) => setTimeout(run, 0))

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_spaces') return Promise.resolve([{ name: 'Work', path: '/spaces/Work' }])
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const BOARD = '/spaces/Work/Board.canvas'
const PLAN = '/spaces/Work/Plan.md'

test('a canvas that no longer reads is not reopened as a blank plane', async () => {
  const { Disk } = await import('../disk')
  disk.current = new Disk()
  disk.current.files.set(BOARD, '{"nodes":[{"id":"a","type":"text","text":"precious"}],"edges":[]}')
  disk.current.files.set(PLAN, '# Plan\n')
  localStorage.clear()

  {
    const { workspace } = await import('../../src/lib/workspace.svelte')
    workspace.spaces = [{ id: 'work', name: 'Work', root: '/spaces/Work' }]
    workspace.activeSpaceId = 'work'
    await workspace.loadTree()
    await workspace.openEntry(PLAN)
    await workspace.openEntry(BOARD)
    expect(workspace.tabs.map((tab) => tab.name)).toEqual(['Plan.md', 'Board.canvas'])
    workspace.persist()
  }

  const broken = '{"nodes":[{"id":"a","type":"text","text":"precious"}],"edges":[],}'
  disk.current.files.set(BOARD, broken)
  vi.resetModules()
  const { workspace } = await import('../../src/lib/workspace.svelte')
  await workspace.restore()
  await vi.waitFor(() => expect(workspace.tabs.map((tab) => tab.name)).toContain('Plan.md'))

  expect(workspace.tabs.map((tab) => tab.name)).toEqual(['Plan.md'])
  expect(disk.current.files.get(BOARD)).toBe(broken)
})
