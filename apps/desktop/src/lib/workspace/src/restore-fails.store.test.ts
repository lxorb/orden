import { describe, expect, test, vi } from 'vitest'

const held = vi.hoisted(() => ({ disk: null as import('../../../../test/disk').Disk | null }))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) =>
    command === 'list_spaces'
      ? Promise.resolve([{ name: 'One', path: '/spaces/One' }])
      : held.disk!.invoke(command, args),
}))
const { Disk, memoryStorage } = await import('../../../../test/disk')
held.disk = new Disk()
held.disk.folders.add('/spaces/One')
held.disk.files.set('/spaces/One/a.md', 'a\n')
vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('navigator', { userAgent: '' })
vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))
vi.stubGlobal('requestIdleCallback', (run: () => void) => setTimeout(run, 0))

const SESSION = {
  version: 2,
  spaces: [{ id: 'one', name: 'One', root: '/spaces/One' }],
  activeSpace: 'one',
  panel: null,
  tabs: [{ kind: 'note', path: '/spaces/One/a.md', name: 'a.md', doc: '', dirty: false }],
  active: 0,
}

async function launch(session: object | null, failing: 'loadSpaces' | 'loadTree') {
  vi.resetModules()
  localStorage.clear()
  if (session) localStorage.setItem('orden:workspace', JSON.stringify(session))
  const { startup } = await import('../../launch/src/api')
  const { workspace } = await import('./workspace.svelte')
  vi.spyOn(workspace, failing).mockRejectedValue(new Error('the disk went'))
  await expect(workspace.restore()).rejects.toThrow('the disk went')
  let doors = false
  void startup.turn('doors').then(() => (doors = true))
  await vi.waitFor(() => expect(doors).toBe(true), { timeout: 3000 })
  expect(workspace.restored).toBe(true)
}

describe('a launch whose restore throws before the first paint', () => {
  test.each([
    ['loadSpaces', 'a kept session', SESSION],
    ['loadTree', 'a kept session', SESSION],
    ['loadSpaces', 'no session', null],
    ['loadTree', 'no session', null],
  ] as const)(
    'where %s fails with %s still lets every later stage take its turn',
    (failing, _, session) => launch(session, failing),
  )
})
