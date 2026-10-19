import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** When the app looks for a new version, and when what it finds is allowed to
 *  say so.
 *
 *  The updater itself is stood in for: what is under test is the rhythm, which
 *  is the part a reader notices. A launch looks; after that a look costs one
 *  interval, however many things ask for one, and the notice waits for a pause
 *  in the typing before it appears.
 *
 *  The clock is moved two ways on purpose. Advancing the timers is an app left
 *  running; setting the time without them is a lid closed at lunch, where the
 *  timers stop and do not make up the difference, and coming back to the window
 *  is what catches up. */

const HOUR = 60 * 60 * 1000
/** The interval in updates.svelte.ts, and the pause the notice waits for. */
const EVERY = 6 * HOUR
const QUIET = 5000
/** Long enough that every tick inside one interval has fired. */
const TICKS = 20 * 60 * 1000

const world = vi.hoisted(() => ({
  version: null as string | null,
  /** The version downloaded and waiting to be installed. The updater answers
   *  nothing while one is, as the real one does, which is how Later holds. */
  staged: null as string | null,
  looks: 0,
  /** The channel each look was made on, in the order they were made. */
  channels: [] as string[],
  /** How many downloaded builds were thrown away rather than installed. */
  discards: 0,
  /** Set for the one test about a look that is still in flight: the look then
   *  waits for `land` instead of answering at once. */
  slow: false,
  land: null as (() => void) | null,
  /** The package manager that keeps the install, null where it updates itself. */
  managed: null as string | null,
  /** The version such an install was told of this run; see updater.ts. */
  announced: null as string | null,
}))

vi.mock('./updater', () => ({
  asChannel: (value: unknown) => (value === 'unstable' ? 'unstable' : 'stable'),
  stageUpdate: (channel: string) => {
    world.looks++
    world.channels.push(channel)
    // Found and never fetched, and found once a run, as the real one does.
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
  discard: () => {
    world.discards++
    world.staged = null
    return Promise.resolve()
  },
}))

/** Storage, in memory. The channel is remembered on the machine rather than on
 *  the account, so the store reads and writes it; see updates.svelte.ts. */
function memoryStorage(): Storage {
  const held = new Map<string, string>()

  return {
    get length() {
      return held.size
    },
    key: (index) => [...held.keys()][index] ?? null,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    clear: () => held.clear(),
  }
}

/** One store for the file, so a re-imported module reads what the last one wrote,
 *  which is what a restart is. Emptied between tests. */
const storage = memoryStorage()

/** The window, with whatever the store listened for kept where a test can fire
 *  it. Under node there is none. */
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

/** Everything in flight, without moving the clock. */
const settle = () => vi.advanceTimersByTimeAsync(0)

/** Time passing with nothing running, the way a sleeping machine passes it. */
const asleep = (span: number) => vi.setSystemTime(Date.now() + span)

let updates: (typeof import('./updates.svelte'))['updates']

beforeEach(async () => {
  vi.useFakeTimers()
  world.looks = 0
  world.version = null
  world.staged = null
  world.channels = []
  world.discards = 0
  world.slow = false
  world.land = null
  world.managed = null
  world.announced = null
  storage.clear()
  stubWindow()
  vi.stubGlobal('localStorage', storage)

  // A fresh store for every test: it is a singleton, and it remembers when it
  // last looked. The desktop is said here rather than at the top of the file so
  // that the one test which is a browser can say otherwise without the next test
  // inheriting it.
  vi.resetModules()
  vi.doMock('./tauri', () => ({ isDesktop: true }))
  updates = (await import('./updates.svelte')).updates
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('looking for a new version', () => {
  test('looks once as the app comes up', async () => {
    const stop = updates.start()
    await settle()

    expect(world.looks).toBe(1)
    stop()
  })

  test('looks again every few hours while the app runs', async () => {
    const stop = updates.start()
    await settle()

    await vi.advanceTimersByTimeAsync(3 * HOUR)
    expect(world.looks).toBe(1)

    await vi.advanceTimersByTimeAsync(3 * HOUR)
    expect(world.looks).toBe(2)

    await vi.advanceTimersByTimeAsync(EVERY)
    expect(world.looks).toBe(3)
    stop()
  })

  test('looks when the window is come back to after that long away', async () => {
    const stop = updates.start()
    await settle()

    asleep(EVERY)
    fire('focus')
    await settle()

    expect(world.looks).toBe(2)
    stop()
  })

  test('does not look again for coming back a moment later', async () => {
    const stop = updates.start()
    await settle()

    fire('focus')
    fire('focus')
    await settle()

    expect(world.looks).toBe(1)
    stop()
  })

  test('looks once per interval however many things ask', async () => {
    const stop = updates.start()
    await settle()

    asleep(EVERY)
    fire('focus')
    fire('focus')
    await vi.advanceTimersByTimeAsync(TICKS)

    expect(world.looks).toBe(2)
    stop()
  })

  test('asked for by name, it looks whatever the clock says', async () => {
    const stop = updates.start()
    await settle()

    await updates.check()

    expect(world.looks).toBe(2)
    stop()
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
    vi.doMock('./tauri', () => ({ isDesktop: false }))
    const web = (await import('./updates.svelte')).updates

    const stop = web.start()
    await vi.advanceTimersByTimeAsync(2 * EVERY)

    expect(world.looks).toBe(0)
    // Not even a listener: there is nothing for one to answer.
    expect(heard.size).toBe(0)
    stop()
  })
})

describe('what a look finds', () => {
  test('is offered as soon as it is found, when nobody is typing', async () => {
    world.version = '1.4.0'
    const stop = updates.start()
    await settle()

    expect(updates.ready).toBe('1.4.0')
    stop()
  })

  test('waits for a pause in the typing rather than landing mid-word', async () => {
    const stop = updates.start()
    await settle()

    world.version = '1.4.0'
    asleep(EVERY)
    fire('keydown')
    fire('focus')
    await settle()

    expect(updates.ready).toBe(null)

    // Still typing a second later, so still nothing.
    await vi.advanceTimersByTimeAsync(1000)
    fire('keydown')
    await vi.advanceTimersByTimeAsync(QUIET - 1000)
    expect(updates.ready).toBe(null)

    await vi.advanceTimersByTimeAsync(QUIET)
    expect(updates.ready).toBe('1.4.0')
    stop()
  })

  test('is not taken away by a later look that finds nothing', async () => {
    world.version = '1.4.0'
    const stop = updates.start()
    await settle()
    expect(updates.ready).toBe('1.4.0')

    // What the updater answers for a version it has already downloaded.
    world.version = null
    asleep(EVERY)
    fire('focus')
    await settle()

    expect(updates.ready).toBe('1.4.0')
    stop()
  })

  test('is offered again after the channel changed and the new stream has one', async () => {
    const stop = updates.start()
    await settle()

    world.version = '0.6.1-84'
    updates.setChannel('unstable')
    await settle()

    expect(updates.ready).toBe('0.6.1-84')
    stop()
  })

  test('dismissed, it stays dismissed', async () => {
    world.version = '1.4.0'
    const stop = updates.start()
    await settle()

    updates.dismiss()
    expect(updates.ready).toBe(null)

    // The release is still out there; the looks nobody asked for go on.
    asleep(EVERY)
    fire('focus')
    await vi.advanceTimersByTimeAsync(2 * EVERY)

    expect(world.looks).toBeGreaterThan(1)
    expect(updates.ready).toBe(null)
    stop()
  })
})

/** The menu's and the palette's Check for updates. Later holds against the looks
 *  nobody asked for; somebody who asks is shown what is waiting, at once. */
describe('asked for by name', () => {
  test('brings back the notice Later put away', async () => {
    world.version = '1.4.0'
    const stop = updates.start()
    await settle()
    updates.dismiss()

    await updates.check()

    expect(updates.ready).toBe('1.4.0')
    stop()
  })

  test('shows what it finds at once, straight after a key', async () => {
    const stop = updates.start()
    await settle()

    // The Enter that chose it in the palette.
    world.version = '1.4.0'
    fire('keydown')
    await updates.check()

    expect(updates.ready).toBe('1.4.0')
    stop()
  })

  test('waits for the look already downloading and shows what it brings', async () => {
    world.slow = true
    world.version = '1.4.0'
    const stop = updates.start()
    await settle()

    fire('keydown')
    const asked = updates.check()
    world.land?.()
    await asked

    expect(world.looks).toBe(1)
    expect(updates.ready).toBe('1.4.0')
    stop()
  })

  test('looks on the stream followed now, not on one still downloading from the stream left', async () => {
    world.slow = true
    world.version = '1.4.0'
    const stop = updates.start()
    await settle()
    updates.setChannel('unstable')
    await settle()

    const asked = updates.check()
    world.slow = false
    world.version = '0.7.0-12'
    world.land?.()
    await asked

    expect(world.channels).toEqual(['stable', 'unstable'])
    expect(updates.ready).toBe('0.7.0-12')
    stop()
  })

  test('with nothing new, shows nothing', async () => {
    const stop = updates.start()
    await settle()

    await updates.check()

    expect(updates.ready).toBe(null)
    stop()
  })
})

/** Which stream the looks are made on. The releases until somebody on this machine
 *  says otherwise, and every look after that is on what was said. */
describe('the channel', () => {
  test('is the releases for a machine that has never chosen', async () => {
    const stop = updates.start()
    await settle()

    expect(updates.channel).toBe('stable')
    expect(world.channels).toEqual(['stable'])
    stop()
  })

  test('is looked on straight away when it changes', async () => {
    const stop = updates.start()
    await settle()

    updates.setChannel('unstable')
    await settle()

    expect(world.channels).toEqual(['stable', 'unstable'])
    stop()
  })

  test('costs nothing when it is set to what it already is', async () => {
    const stop = updates.start()
    await settle()

    updates.setChannel('stable')
    await settle()

    expect(world.looks).toBe(1)
    expect(world.discards).toBe(0)
    stop()
  })

  test('is remembered on the machine, so the next start follows the same one', async () => {
    const stop = updates.start()
    await settle()
    updates.setChannel('unstable')
    await settle()
    stop()

    expect(storage.getItem('nib:channel')).toBe('unstable')

    // A restart: the store is built again and reads what this machine wrote.
    vi.resetModules()
    vi.doMock('./tauri', () => ({ isDesktop: true }))
    const next = (await import('./updates.svelte')).updates

    expect(next.channel).toBe('unstable')
  })

  test('throws away the build downloaded from the stream that was left', async () => {
    world.version = '1.4.0'
    const stop = updates.start()
    await settle()
    expect(updates.ready).toBe('1.4.0')

    // Nothing newer on the other stream, which is the point: the build that was
    // downloaded goes, and the notice offering it goes with it.
    world.version = null
    updates.setChannel('unstable')
    await settle()

    expect(world.discards).toBe(1)
    expect(updates.ready).toBe(null)
    stop()
  })

  test('drops what a look already in flight brings back from the old stream', async () => {
    world.slow = true
    world.version = '1.4.0'
    const stop = updates.start()
    await settle()
    expect(world.looks).toBe(1)

    // The channel changes while the download is still running.
    updates.setChannel('unstable')
    await settle()
    // Nothing new to look at yet: the look in flight holds the next one off.
    expect(world.looks).toBe(1)

    world.land?.()
    await settle()

    // Once for the change itself, once for what the look landed with.
    expect(world.discards).toBe(2)
    expect(updates.ready).toBe(null)
    stop()
  })

  test('is looked on as soon as the look in flight has landed', async () => {
    world.slow = true
    const stop = updates.start()
    await settle()

    updates.setChannel('unstable')
    world.slow = false
    world.land?.()
    await settle()

    expect(world.channels).toEqual(['stable', 'unstable'])
    stop()
  })
})

/** An install a package manager keeps: told of a newer version, once, and nothing to
 *  press. The manager installs it; see updater.ts. */
describe('where a package manager keeps the install', () => {
  /** The app quit and started again: a new process, which has told nothing yet. */
  async function relaunch() {
    world.announced = null
    vi.resetModules()
    vi.doMock('./tauri', () => ({ isDesktop: true }))
    return (await import('./updates.svelte')).updates
  }

  test('says what is out, as news', async () => {
    world.managed = 'scoop'
    world.version = '1.4.0'
    const stop = updates.start()
    await settle()

    expect(updates.ready).toBe('1.4.0')
    expect(updates.managed).toBe(true)
    stop()
  })

  test('says it once, not again on the next launch', async () => {
    world.managed = 'brew'
    world.version = '1.4.0'
    const stop = updates.start()
    await settle()
    expect(updates.ready).toBe('1.4.0')
    stop()

    const next = await relaunch()
    const stopNext = next.start()
    await settle()

    expect(world.looks).toBe(2)
    expect(next.ready).toBe(null)
    stopNext()
  })

  test('nor later in the same run, once it has gone', async () => {
    world.managed = 'apt'
    world.version = '1.4.0'
    const stop = updates.start()
    await settle()
    updates.dismiss()

    asleep(EVERY)
    fire('focus')
    await settle()

    expect(world.looks).toBe(2)
    expect(updates.ready).toBe(null)
    stop()
  })

  test('says the next version when it comes', async () => {
    world.managed = 'flatpak'
    world.version = '1.4.0'
    const stop = updates.start()
    await settle()
    updates.dismiss()

    world.version = '1.5.0'
    asleep(EVERY)
    fire('focus')
    await settle()

    expect(updates.ready).toBe('1.5.0')
    stop()
  })

  test('asked for by name, says it again', async () => {
    world.managed = 'choco'
    world.version = '1.4.0'
    const stop = updates.start()
    await settle()
    stop()

    const next = await relaunch()
    const stopNext = next.start()
    await settle()
    await next.check()

    expect(next.ready).toBe('1.4.0')
    stopNext()
  })

  test('an install that updates itself is offered the update as before', async () => {
    world.version = '1.4.0'
    const stop = updates.start()
    await settle()

    expect(updates.ready).toBe('1.4.0')
    expect(updates.managed).toBe(false)
    expect(storage.getItem('nib:update-told')).toBe(null)
    stop()
  })
})
