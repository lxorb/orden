import { describe, expect, test, vi } from 'vitest'

const held = vi.hoisted(() => ({
  disk: null as import('../../../../test/disk').Disk | null,
  slow: null as string | null,
  release: (): void => undefined,
}))
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
    if (command === 'read_tree' && args?.root === held.slow) {
      held.slow = null
      await new Promise<void>((go) => (held.release = go))
    }
    return held.disk!.invoke(command, args)
  },
}))
const { Disk, memoryStorage } = await import('../../../../test/disk')
held.disk = new Disk()
held.disk.folders.add('/spaces/One')
held.disk.folders.add('/spaces/Two')
held.disk.files.set('/spaces/One/one.md', 'one\n')
held.disk.files.set('/spaces/Two/two.md', 'two\n')
vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('navigator', { userAgent: '' })
vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))

const { workspace } = await import('./workspace.svelte')

describe('a tree that comes back after the space changed', () => {
  test('never replaces the tree of the space now shown', async () => {
    await workspace.loadSpaces()
    const [one, two] = workspace.spaces
    workspace.activeSpaceId = one!.id
    held.slow = one!.root
    const late = workspace.loadTree()
    await vi.waitFor(() => expect(held.slow).toBe(null))

    workspace.activeSpaceId = two!.id
    await workspace.loadTree()
    expect(workspace.tree?.path).toBe(two!.root)

    held.release()
    await late
    expect(workspace.tree?.path).toBe(two!.root)
    expect(workspace.files.map((file) => file.path)).toEqual(['/spaces/Two/two.md'])
  })
})
