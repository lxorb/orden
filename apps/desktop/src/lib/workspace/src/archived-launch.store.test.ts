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
vi.stubGlobal('navigator', { userAgent: '' })
vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))
test('a launch never comes back on an archived space, though the window was left on it', async () => {
  localStorage.setItem(
    'orden:workspace',
    JSON.stringify({
      version: 2,
      spaces: [
        { id: 'one', name: 'One', root: '/spaces/One' },
        { id: 'two', name: 'Two', root: '/spaces/Two' },
      ],
      activeSpace: 'one',
      panel: null,
      layout: {
        frame: { kind: 'pane', pane: { id: 'p1', active: 0, linked: false, tabs: [] } },
        focused: 'p1',
        panel: null,
      },
      closed: [],
    }),
  )
  localStorage.setItem('orden:archived-spaces', JSON.stringify(['/spaces/One']))
  const { startup } = await import('../../launch/src/api')
  const turn = startup.turn.bind(startup)
  startup.turn = (stage) => (stage === 'doors' ? new Promise(() => undefined) : turn(stage))
  const { workspace } = await import('./workspace.svelte')
  await workspace.restore()
  expect(workspace.activeSpaceId).toBe('two')
  expect(workspace.openedArchived).toBeNull()
})
