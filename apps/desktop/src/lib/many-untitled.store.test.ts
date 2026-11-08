import { describe, expect, test, vi } from 'vitest'
import { GROWS_AT_MOST } from '../../../../scripts/growth'

const disk = vi.hoisted(() => ({ current: null as import('../../test/disk').Disk | null }))

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const { Disk, memoryStorage } = await import('../../test/disk')
disk.current = new Disk(true)
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('./workspace.svelte')

const ROOT = '/space'

async function spaceOf(size: number) {
  const one = disk.current
  if (!one) throw new Error('no disk')
  one.reset()
  for (let at = 0; at < size; at++) one.files.set(`${ROOT}/notes/note ${at}.md`, '')
  for (let at = 1; at <= size / 4; at++) {
    one.files.set(`${ROOT}/${at === 1 ? 'Untitled' : `Untitled ${at}`}.md`, '')
  }
  workspace.spaces = [{ id: 's', name: 'Notes', root: ROOT }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  await workspace.loadTree()
}

async function fastest(size: number): Promise<number> {
  await spaceOf(size)
  let least = Infinity
  for (let round = 0; round < 5; round++) {
    const started = performance.now()
    const name = await workspace.freeNameOnDisk(ROOT, 'Untitled.md')
    least = Math.min(least, performance.now() - started)
    expect(name).toBe(`Untitled ${size / 4 + 1}.md`)
  }
  return least
}

describe('a new note’s name in a space full of untitled notes', () => {
  test('is found in time that grows with the space, not with the space times the untitled', async () => {
    await fastest(400)
    const small = await fastest(800)
    const large = await fastest(3200)
    expect(large / Math.max(small, 0.05)).toBeLessThan(GROWS_AT_MOST)
  }, 60000)
})
