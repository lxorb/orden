import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

const HOUR = 60 * 60 * 1000
const EVERY = 6 * HOUR
const QUIET = 5000
const TICKS = 20 * 60 * 1000
const world = vi.hoisted(() => ({
  version: null as string | null,
  staged: null as string | null,
  looks: 0,
  channels: [] as string[],
  discards: 0,
  slow: false,
  land: null as (() => void) | null,
  managed: null as string | null,
  announced: null as string | null,
}))
vi.mock('./updater', () => ({
  asChannel: (value: unknown) => (value === 'unstable' ? 'unstable' : 'stable'),
  hearHandedOn: () => () => undefined,
  stageUpdate: (channel: string) => {
    world.looks++
    world.channels.push(channel)
    if (world.managed) {
      if (!world.version || world.version === world.announced) return Promise.resolve(null)
      world.announced = world.version
      return Promise.resolve(world.announced)
    }
    if (world.staged) return Promise.resolve(null)
    const landed = () => (world.staged = world.version)
    if (!world.slow) return Promise.resolve(landed())
    return new Promise<string | null>((resolve) => {
      world.land = () => resolve(landed())
    })
  },
  stagedVersion: () => world.staged,
  announcedVersion: () => world.announced,
  managedBy: () => Promise.resolve(world.managed),
  updatedBySystem: (manager: string | null) => manager === 'apt' || manager === 'dnf',
  discard: () => {
    world.discards++
    world.staged = null
    return Promise.resolve()
  },
}))
const storage = memoryStorage()
const heard = new Map<string, Set<() => void>>()
function stubWindow() {
  heard.clear()
  vi.stubGlobal('window', {
    addEventListener: (name: string, listener: () => void) => {
      const listeners = heard.get(name) ?? new Set<() => void>()
      listeners.add(listener)
      heard.set(name, listeners)
    },
    removeEventListener: (name: string, listener: () => void) => {
      heard.get(name)?.delete(listener)
    },
  })
}
const fire = (name: string) => {
  for (const listener of heard.get(name) ?? []) listener()
}
const settle = () => vi.advanceTimersByTimeAsync(0)
const asleep = (span: number) => vi.setSystemTime(Date.now() + span)
let updates: (typeof import('./updates.svelte'))['updates']
const stops: (() => void)[] = []
const started = async (store = updates) => {
  stops.push(store.start())
  await settle()
}
beforeEach(async () => {
  vi.useFakeTimers()
  Object.assign(world, {
    looks: 0,
    version: null,
    staged: null,
    channels: [],
    discards: 0,
    slow: false,
    land: null,
    managed: null,
    announced: null,
  })
  storage.clear()
  stubWindow()
  vi.stubGlobal('localStorage', storage)
  vi.resetModules()
  vi.doMock('../../platform/src/tauri', () => ({ isDesktop: true }))
  updates = (await import('./updates.svelte')).updates
})
afterEach(() => {
  for (const stop of stops.splice(0)) stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
describe('looking for a new version', () => {
  test('looks once as the app comes up', async () => {
    await started()
    expect(world.looks).toBe(1)
  })
  test('looks again every few hours while the app runs', async () => {
    await started()
    await vi.advanceTimersByTimeAsync(3 * HOUR)
    expect(world.looks).toBe(1)
    await vi.advanceTimersByTimeAsync(3 * HOUR)
    expect(world.looks).toBe(2)
    await vi.advanceTimersByTimeAsync(EVERY)
    expect(world.looks).toBe(3)
  })
  test('looks when the window is come back to after that long away', async () => {
    await started()
    asleep(EVERY)
    fire('focus')
    await settle()
    expect(world.looks).toBe(2)
  })
  test('does not look again for coming back a moment later', async () => {
    await started()
    fire('focus')
    fire('focus')
    await settle()
    expect(world.looks).toBe(1)
  })
  test('looks once per interval however many things ask', async () => {
    await started()
    asleep(EVERY)
    fire('focus')
    fire('focus')
    await vi.advanceTimersByTimeAsync(TICKS)
    expect(world.looks).toBe(2)
  })
  test('asked for by name, it looks whatever the clock says', async () => {
    await started()
    await updates.check()
    expect(world.looks).toBe(2)
  })
  test('stops looking when the app goes down', async () => {
    const stop = updates.start()
    await settle()
    stop()
    asleep(EVERY)
    fire('focus')
    await vi.advanceTimersByTimeAsync(2 * EVERY)
    expect(world.looks).toBe(1)
  })
  test('looks for nothing at all on the web or a phone', async () => {
    vi.resetModules()
    vi.doMock('../../platform/src/tauri', () => ({ isDesktop: false }))
    const web = (await import('./updates.svelte')).updates
    const stop = web.start()
    await vi.advanceTimersByTimeAsync(2 * EVERY)
    expect(world.looks).toBe(0)
    expect(heard.size).toBe(0)
    stop()
  })
})
describe('what a look finds', () => {
  test('is offered as soon as it is found, when nobody is typing', async () => {
    world.version = '1.4.0'
    await started()
    expect(updates.ready).toBe('1.4.0')
  })
  test('waits for a pause in the typing rather than landing mid-word', async () => {
    await started()
    world.version = '1.4.0'
    asleep(EVERY)
    fire('keydown')
    fire('focus')
    await settle()
    expect(updates.ready).toBe(null)
    await vi.advanceTimersByTimeAsync(1000)
    fire('keydown')
    await vi.advanceTimersByTimeAsync(QUIET - 1000)
    expect(updates.ready).toBe(null)
    await vi.advanceTimersByTimeAsync(QUIET)
    expect(updates.ready).toBe('1.4.0')
  })
  test('is not taken away by a later look that finds nothing', async () => {
    world.version = '1.4.0'
    await started()
    expect(updates.ready).toBe('1.4.0')
    world.version = null
    asleep(EVERY)
    fire('focus')
    await settle()
    expect(updates.ready).toBe('1.4.0')
  })
  test('is offered again after the channel changed and the new stream has one', async () => {
    await started()
    world.version = '0.6.1-84'
    updates.setChannel('unstable')
    await settle()
    expect(updates.ready).toBe('0.6.1-84')
  })
  test('dismissed, it stays dismissed', async () => {
    world.version = '1.4.0'
    await started()
    updates.dismiss()
    expect(updates.ready).toBe(null)
    asleep(EVERY)
    fire('focus')
    await vi.advanceTimersByTimeAsync(2 * EVERY)
    expect(world.looks).toBeGreaterThan(1)
    expect(updates.ready).toBe(null)
  })
})
describe('asked for by name', () => {
  test('brings back the notice Later put away', async () => {
    world.version = '1.4.0'
    await started()
    updates.dismiss()
    await updates.check()
    expect(updates.ready).toBe('1.4.0')
  })
  test('shows what it finds at once, straight after a key', async () => {
    await started()
    world.version = '1.4.0'
    fire('keydown')
    await updates.check()
    expect(updates.ready).toBe('1.4.0')
  })
  test('waits for the look already downloading and shows what it brings', async () => {
    world.slow = true
    world.version = '1.4.0'
    await started()
    fire('keydown')
    const asked = updates.check()
    world.land?.()
    await asked
    expect(world.looks).toBe(1)
    expect(updates.ready).toBe('1.4.0')
  })
  test('looks on the stream followed now, not on one still downloading from the stream left', async () => {
    world.slow = true
    world.version = '1.4.0'
    await started()
    updates.setChannel('unstable')
    await settle()
    const asked = updates.check()
    world.slow = false
    world.version = '0.7.0-12'
    world.land?.()
    await asked
    expect(world.channels).toEqual(['stable', 'unstable'])
    expect(updates.ready).toBe('0.7.0-12')
  })
  test('with nothing new, shows nothing', async () => {
    await started()
    await updates.check()
    expect(updates.ready).toBe(null)
  })
})
describe('the channel', () => {
  test('is the releases for a machine that has never chosen', async () => {
    await started()
    expect(updates.channel).toBe('stable')
    expect(world.channels).toEqual(['stable'])
  })
  test('is looked on straight away when it changes', async () => {
    await started()
    updates.setChannel('unstable')
    await settle()
    expect(world.channels).toEqual(['stable', 'unstable'])
  })
  test('costs nothing when it is set to what it already is', async () => {
    await started()
    updates.setChannel('stable')
    await settle()
    expect(world.looks).toBe(1)
    expect(world.discards).toBe(0)
  })
  test('is remembered on the machine, so the next start follows the same one', async () => {
    const stop = updates.start()
    await settle()
    updates.setChannel('unstable')
    await settle()
    stop()
    expect(storage.getItem('orden:channel')).toBe('unstable')
    vi.resetModules()
    vi.doMock('../../platform/src/tauri', () => ({ isDesktop: true }))
    const next = (await import('./updates.svelte')).updates
    expect(next.channel).toBe('unstable')
  })
  test('throws away the build downloaded from the stream that was left', async () => {
    world.version = '1.4.0'
    await started()
    expect(updates.ready).toBe('1.4.0')
    world.version = null
    updates.setChannel('unstable')
    await settle()
    expect(world.discards).toBe(1)
    expect(updates.ready).toBe(null)
  })
  test('drops what a look already in flight brings back from the old stream', async () => {
    world.slow = true
    world.version = '1.4.0'
    await started()
    expect(world.looks).toBe(1)
    updates.setChannel('unstable')
    await settle()
    expect(world.looks).toBe(1)
    world.land?.()
    await settle()
    expect(world.discards).toBe(2)
    expect(updates.ready).toBe(null)
  })
  test('is looked on as soon as the look in flight has landed', async () => {
    world.slow = true
    await started()
    updates.setChannel('unstable')
    world.slow = false
    world.land?.()
    await settle()
    expect(world.channels).toEqual(['stable', 'unstable'])
  })
})
describe('where a package manager keeps the install', () => {
  async function relaunch() {
    world.announced = null
    vi.resetModules()
    vi.doMock('../../platform/src/tauri', () => ({ isDesktop: true }))
    return (await import('./updates.svelte')).updates
  }
  test('says what is out, as news', async () => {
    world.managed = 'scoop'
    world.version = '1.4.0'
    await started()
    expect(updates.ready).toBe('1.4.0')
    expect(updates.managed).toBe(true)
  })
  test('says it once, not again on the next launch', async () => {
    world.managed = 'brew'
    world.version = '1.4.0'
    const stop = updates.start()
    await settle()
    expect(updates.ready).toBe('1.4.0')
    stop()
    const next = await relaunch()
    await started(next)
    expect(world.looks).toBe(2)
    expect(next.ready).toBe(null)
  })
  test('nor later in the same run, once it has gone', async () => {
    world.managed = 'apt'
    world.version = '1.4.0'
    await started()
    updates.dismiss()
    asleep(EVERY)
    fire('focus')
    await settle()
    expect(world.looks).toBe(2)
    expect(updates.ready).toBe(null)
  })
  test('says the next version when it comes', async () => {
    world.managed = 'flatpak'
    world.version = '1.4.0'
    await started()
    updates.dismiss()
    world.version = '1.5.0'
    asleep(EVERY)
    fire('focus')
    await settle()
    expect(updates.ready).toBe('1.5.0')
  })
  test('asked for by name, says it again', async () => {
    world.managed = 'choco'
    world.version = '1.4.0'
    const stop = updates.start()
    await settle()
    stop()
    const next = await relaunch()
    await started(next)
    await next.check()
    expect(next.ready).toBe('1.4.0')
  })
  test('a .deb or an .rpm is offered the update on the next launch too', async () => {
    world.managed = 'dnf'
    world.version = '1.4.0'
    const stop = updates.start()
    await settle()
    expect(updates.ready).toBe('1.4.0')
    expect(updates.system).toBe(true)
    stop()
    const next = await relaunch()
    await started(next)
    expect(next.ready).toBe('1.4.0')
    expect(storage.getItem('orden:update-told')).toBe(null)
  })
  test('an install that updates itself is offered the update as before', async () => {
    world.version = '1.4.0'
    await started()
    expect(updates.ready).toBe('1.4.0')
    expect(updates.managed).toBe(false)
    expect(storage.getItem('orden:update-told')).toBe(null)
  })
})
