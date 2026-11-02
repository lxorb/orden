import { expect, test, vi } from 'vitest'

/** A tab left on a space's AGENTS.md by a version that still opened it as a note. Clean,
 *  it does not come back: the file is a field in the space's settings now. With words
 *  unsaved it does, as it was, and the words reach the file; losing them over a change of
 *  presentation is the one thing this must not do. Two runs of the store, the second a
 *  fresh import of every module, the way a relaunch reads what the first wrote. */

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

const AGENTS = '/spaces/Work/AGENTS.md'
const STAND_IN = '/spaces/Work/Stand-in.md'
const PLAN = '/spaces/Work/Plan.md'

/** The session an earlier version wrote: this one will not open the file as a tab, so a
 *  tab of another name is left open and the name changed on what was written down. */
async function leftOpen(typed: string | null) {
  const { Disk } = await import('../disk')
  disk.current = new Disk()
  disk.current.files.set(AGENTS, '# Rules\n')
  disk.current.files.set(STAND_IN, '# Rules\n')
  disk.current.files.set(PLAN, '# Plan\n')
  localStorage.clear()
  vi.resetModules()

  const { workspace } = await import('../../src/lib/workspace.svelte')
  workspace.spaces = [{ id: 'work', name: 'Work', root: '/spaces/Work' }]
  workspace.activeSpaceId = 'work'
  await workspace.loadTree()
  await workspace.openEntry(PLAN)
  await workspace.openEntry(STAND_IN)
  const tab = workspace.tabs.find((one) => one.path === STAND_IN)
  if (!tab?.note) throw new Error('the tab did not open')
  if (typed !== null) {
    tab.note.replace(typed, true)
    tab.note.dirty = true
  }
  workspace.persist()

  for (let at = 0; at < localStorage.length; at++) {
    const key = localStorage.key(at) ?? ''
    const held = localStorage.getItem(key) ?? ''
    if (held.includes('Stand-in'))
      localStorage.setItem(key, held.replaceAll('Stand-in.md', 'AGENTS.md'))
  }
  disk.current.files.delete(STAND_IN)
  vi.resetModules()
  return (await import('../../src/lib/workspace.svelte')).workspace
}

test('a clean tab on it is not put back, and the file stays', async () => {
  const workspace = await leftOpen(null)
  await workspace.restore()
  await vi.waitFor(() => expect(workspace.tabs.map((tab) => tab.name)).toContain('Plan.md'))

  expect(workspace.tabs.map((tab) => tab.path)).toEqual([PLAN])
  expect(disk.current?.files.get(AGENTS)).toBe('# Rules\n')
})

test('a tab with words unsaved is put back with them, and they are written', async () => {
  const workspace = await leftOpen('# Rules\n\n- unsaved\n')
  await workspace.restore()
  await vi.waitFor(() => expect(workspace.tabs.map((tab) => tab.path)).toContain(AGENTS))

  const tab = workspace.tabs.find((one) => one.path === AGENTS)
  expect(tab?.note?.text).toBe('# Rules\n\n- unsaved\n')
  expect(tab?.note?.dirty).toBe(true)

  workspace.flush()
  await workspace.writesSettled()
  expect(disk.current?.files.get(AGENTS)).toBe('# Rules\n\n- unsaved\n')
})
