import { expect, test, vi } from 'vitest'

const held = vi.hoisted(() => ({ disk: null as import('../../../../test/disk').Disk | null }))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_spaces') {
      return [
        { name: 'One', path: '/spaces/One' },
        { name: 'Two', path: '/spaces/Two' },
      ]
    }
    return held.disk?.invoke(command, args)
  },
}))
const { Disk, memoryStorage } = await import('../../../../test/disk')
held.disk = new Disk()
held.disk.folders.add('/spaces/One').add('/spaces/Two')
vi.stubGlobal('localStorage', memoryStorage())
function fakeLocks(): LockManager {
  return {
    request(name: string, ...rest: unknown[]) {
      const run = rest.at(-1) as (lock: unknown) => unknown
      return Promise.resolve(run({ name }))
    },
  } as unknown as LockManager
}
vi.stubGlobal('navigator', { userAgent: '', locks: fakeLocks() })
vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))
const pane = (id: string, tabs: object[]) => ({
  frame: { kind: 'pane', pane: { id, active: 0, linked: false, tabs } },
  focused: id,
  panel: null,
})
const draft = (name: string, doc: string, space?: string) => ({
  kind: 'note',
  path: null,
  name,
  doc,
  dirty: true,
  cursor: 0,
  scroll: 0,
  ...(space ? { space } : {}),
})
test("a closed window's leftover draft goes to its own space's set, and one of no space to the set on screen", async () => {
  localStorage.setItem(
    'orden:spaces',
    JSON.stringify([
      { id: 'one', name: 'One', root: '/spaces/One' },
      { id: 'two', name: 'Two', root: '/spaces/Two' },
    ]),
  )
  const spaces = [
    { id: 'one', name: 'One', root: '/spaces/One' },
    { id: 'two', name: 'Two', root: '/spaces/Two' },
  ]
  localStorage.setItem(
    'orden:workspace',
    JSON.stringify({ version: 2, spaces, activeSpace: 'one', panel: null, layout: pane('p1', []), closed: [] }),
  )
  localStorage.setItem(
    'orden:workspace:1',
    JSON.stringify({
      version: 2,
      spaces,
      activeSpace: 'two',
      panel: null,
      layout: pane('q1', [draft('Away', 'WRITTEN IN TWO', 'two'), draft('Nowhere', 'WRITTEN IN NO SPACE')]),
      closed: [],
    }),
  )
  const { startup } = await import('../../launch/src/api')
  const turn = startup.turn.bind(startup)
  startup.turn = (stage) => (stage === 'doors' ? new Promise(() => undefined) : turn(stage))
  const { workspace } = await import('./workspace.svelte')
  await workspace.restore()
  await vi.waitFor(() =>
    expect(workspace.tabs.map((one) => one.doc).sort()).toEqual(['WRITTEN IN NO SPACE', 'WRITTEN IN TWO']),
  )
  const here = () => workspace.tabs.filter((one) => workspace.panes.at(one.paneId)).map((one) => one.doc)
  await vi.waitFor(() => expect(here()).toEqual(['WRITTEN IN NO SPACE']))
  const { sets } = await import('./sets.svelte')
  expect(sets.tabsOf('two').map((one) => one.doc)).toEqual(['WRITTEN IN TWO'])
})
