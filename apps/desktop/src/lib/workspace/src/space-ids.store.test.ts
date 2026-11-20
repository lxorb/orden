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
held.disk.files.set('/spaces/One/Trip.md', '# Trip\n')
vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('navigator', { userAgent: '' })
vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))
test('a window saved by an older build takes the ids every window shares, and keeps its tabs and its space', async () => {
  localStorage.setItem(
    'orden:spaces',
    JSON.stringify([
      { id: 'two', name: 'Two', root: '/spaces/Two' },
      { id: 'one', name: 'One', root: '/spaces/One' },
    ]),
  )
  localStorage.setItem(
    'orden:workspace',
    JSON.stringify({
      version: 2,
      spaces: [
        { id: 'mine-one', name: 'One', root: '/spaces/One' },
        { id: 'mine-two', name: 'Two', root: '/spaces/Two' },
      ],
      activeSpace: 'mine-one',
      panel: null,
      layout: {
        frame: {
          kind: 'pane',
          pane: {
            id: 'p1',
            active: 0,
            linked: false,
            tabs: [
              {
                kind: 'note',
                path: null,
                name: 'Draft',
                doc: 'words',
                dirty: true,
                cursor: 0,
                scroll: 0,
                space: 'mine-one',
              },
            ],
          },
        },
        focused: 'p1',
        panel: null,
      },
      closed: [],
    }),
  )
  const { startup } = await import('../../launch/src/api')
  const turn = startup.turn.bind(startup)
  startup.turn = (stage) => (stage === 'doors' ? new Promise(() => undefined) : turn(stage))
  const { workspace } = await import('./workspace.svelte')
  await workspace.restore()
  expect(workspace.spaces.map((one) => one.id)).toEqual(['two', 'one'])
  expect(workspace.activeSpaceId).toBe('one')
  expect(workspace.tabs.map((one) => [one.name, one.note.home])).toEqual([['Draft', 'one']])
})
