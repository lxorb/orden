import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'

const disk = vi.hoisted(() => ({ current: null as import('../../../../test/disk').Disk | null }))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: false,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    if (command === 'list_spaces') {
      return Promise.resolve(
        [...disk.current.folders]
          .filter((path) => /^\/spaces\/[^/]+$/.test(path))
          .map((path) => ({ name: path.split('/').pop(), path })),
      )
    }
    return disk.current.invoke(command, args)
  },
}))
const { Disk, memoryStorage } = await import('../../../../test/disk')
disk.current = new Disk()
vi.stubGlobal('localStorage', memoryStorage())
const { workspace, spaceSets } = await import('../../workspace/src/api')
const { autoTidy, seen, startAutoTidy } = await import('./api')
const HOUR = 3_600_000
const T0 = Date.UTC(2026, 10, 19, 9)
const WORK = { id: 'work', name: 'Work', root: '/spaces/Work' }
const FOOD = { id: 'food', name: 'Food', root: '/spaces/Food' }
const at = (name: string) => `${WORK.root}/${name}.md`
const held = () => workspace.tabs.flatMap((tab) => (tab.path === null ? [] : [tab.path]))
let stop: (() => void) | null = null
beforeEach(async () => {
  vi.useFakeTimers({ now: T0, toFake: ['Date'] })
  const one = disk.current!
  one.reset()
  one.folders.add(WORK.root).add(FOOD.root)
  for (const name of ['Plan', 'Old', 'Dirty']) one.files.set(at(name), `# ${name}\n`)
  one.files.set(`${FOOD.root}/Food.md`, '# Food\n')
  workspace.spaces = [{ ...WORK }, { ...FOOD }]
  workspace.activeSpaceId = 'work'
  await spaceSets()
  workspace.restored = true
  autoTidy.set(false)
  autoTidy.setHours(24)
  autoTidy.set(true)
  stop = startAutoTidy()
  await workspace.open(at('Old'))
  await workspace.open(at('Dirty'))
  await workspace.open(at('Plan'))
  const dirty = workspace.tabs.find((tab) => tab.path === at('Dirty'))
  if (dirty) dirty.dirty = true
  flushSync()
  await workspace.selectSpace('food')
  await workspace.open(`${FOOD.root}/Food.md`)
  flushSync()
})
afterEach(async () => {
  stop?.()
  stop = null
  await workspace.selectSpace('work')
  workspace.closeEach(workspace.tabs.map((tab) => tab.id))
  vi.useRealTimers()
  await vi.dynamicImportSettled()
})
describe('a space put aside', () => {
  test('keeps counting, and coming back after the time closes its stale tabs at once', async () => {
    expect(held()).toEqual(expect.arrayContaining([at('Old'), at('Dirty'), at('Plan')]))
    vi.setSystemTime(T0 + 25 * HOUR)
    await workspace.selectSpace('work')
    await vi.waitFor(() => expect(held()).not.toContain(at('Old')))
    expect(held()).toEqual(expect.arrayContaining([at('Plan'), at('Dirty')]))
    expect(workspace.active?.path).toBe(at('Plan'))
  })
  test('keeps what was seen of its tabs while away and back within the time', async () => {
    const before = seen.of(at('Old'))
    expect(before).toBe(T0)
    vi.setSystemTime(T0 + 2 * HOUR)
    await workspace.selectSpace('work')
    flushSync()
    await workspace.selectSpace('food')
    flushSync()
    expect(seen.of(at('Old'))).toBe(before)
    expect(held()).toContain(at('Old'))
  })
  test('forgets what was seen of a tab only once it is truly closed', async () => {
    await workspace.selectSpace('work')
    flushSync()
    const old = workspace.tabs.find((tab) => tab.path === at('Old'))
    if (!old) throw new Error('no tab')
    expect(seen.of(at('Old'))).toBe(T0)
    workspace.close(old.id)
    flushSync()
    expect(seen.of(at('Old'))).toBeUndefined()
  })
})
