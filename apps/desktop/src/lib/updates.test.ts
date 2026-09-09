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

const world = vi.hoisted(() => ({ version: null as string | null, looks: 0 }))

vi.mock('./updater', () => ({
  stageUpdate: () => {
    world.looks++
    return Promise.resolve(world.version)
  },
}))

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
  stubWindow()

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

  test('dismissed, it stays dismissed', async () => {
    world.version = '1.4.0'
    const stop = updates.start()
    await settle()

    updates.dismiss()
    expect(updates.ready).toBe(null)

    world.version = null
    await vi.advanceTimersByTimeAsync(2 * EVERY)

    expect(updates.ready).toBe(null)
    stop()
  })
})
