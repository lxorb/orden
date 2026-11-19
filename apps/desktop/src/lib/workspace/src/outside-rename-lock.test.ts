import { expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../../../../test/disk').Disk | null }))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => disk.current!.invoke(command, args),
}))
const { Disk, memoryStorage } = await import('../../../../test/disk')
const d = new Disk()
disk.current = d
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('./api')
await import('../../workspace-ports')
const { startAcross } = await import('./across')
await startAcross()
const { heardChange } = await import('./outside.svelte')
const { protection } = await import('../../protect/src/api')
test('a locked note renamed outside Orden keeps its lock', async () => {
  d.reset()
  d.folders.add('/s')
  d.files.set('/s/Secret.md', 'diary words\n')
  workspace.spaces = [{ id: 'S', name: 's', root: '/s' }]
  workspace.activeSpaceId = 'S'
  await workspace.loadTree()
  protection.set('/s', '/s/Secret.md', 'device')
  expect(protection.agentsMay('/s/Secret.md')).toBe(false)
  d.files.delete('/s/Secret.md')
  d.files.set('/s/Open.md', 'diary words\n')
  await heardChange({
    kind: 'renamed',
    from: '/s/Secret.md',
    path: '/s/Open.md',
    size: 1,
    mtime: 1,
    id: null,
    dir: false,
  })
  console.log('ways after outside rename', JSON.stringify(protection.ways('/s')))
  expect(protection.agentsMay('/s/Open.md')).toBe(false)
  expect(protection.ways('/s')).toEqual({ 'Open.md': 'device' })
})
