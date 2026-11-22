import { expect, test, vi } from 'vitest'

const held = vi.hoisted(() => ({ disk: null as import('../../../../test/disk').Disk | null }))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_spaces') return [{ name: 'Work', path: '/spaces/Work' }]
    return held.disk?.invoke(command, args)
  },
}))
const { Disk, memoryStorage } = await import('../../../../test/disk')
held.disk = new Disk()
held.disk.folders.add('/spaces/Work')
vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('navigator', { userAgent: '' })
vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))
const ITEM = { id: 'shared-plan', name: 'Plan', path: '/Team/Plan.md' }
async function launch() {
  await vi.dynamicImportSettled()
  vi.resetModules()
  const { startup } = await import('../../launch/src/api')
  const turn = startup.turn.bind(startup)
  startup.turn = (stage) => (stage === 'doors' ? new Promise(() => undefined) : turn(stage))
  const { workspace } = await import('./workspace.svelte')
  workspace.spaces = [{ id: 'work', name: 'Work', root: '/spaces/Work' }]
  return workspace
}
test('a shared note opened from its link again and again, with reloads between, is one tab', async () => {
  let workspace = await launch()
  for (let round = 0; round < 3; round += 1) {
    if (round > 0) {
      workspace = await launch()
      await workspace.restore()
      await (await import('./sets.svelte')).sets.wake()
      expect(workspace.showingShared(ITEM.id)).toBe(true)
    }
    workspace.openShared(ITEM, '# Plan\n')
    const open = workspace.tabs.find((one) => one.note.shared === ITEM.id)
    open?.note.live.replace(`# Plan\n\nwritten in round ${String(round)}\n`)
    expect(workspace.persist()).toBe(true)
  }
  expect(workspace.tabs.filter((one) => one.note.shared === ITEM.id || one.name === ITEM.name)).toHaveLength(1)
  expect(workspace.active?.note.shared).toBe(ITEM.id)
})
