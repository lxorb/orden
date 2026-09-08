import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

/** Device-local settings across launches of a packed plugin.
 *
 *  The plugin is served from `http://127.0.0.1:<port>` with a new port every
 *  launch, so the page's own `localStorage` is a different origin's each time
 *  and always empty. The cookie is the exception: cookies are scoped to the host
 *  and ignore the port, which is why on a real device it was the one page store
 *  that came back with anything. This is that, twice over. */

const phone = vi.hoisted(() => ({ held: new Map<string, string>(), reachable: false }))

vi.mock('./sdk', () => ({
  connectStore: async () => {
    while (!phone.reachable) await new Promise((resolve) => setTimeout(resolve, 20))

    return {
      read: (key: string) => Promise.resolve(phone.held.get(key) ?? ''),
      write: (key: string, value: string) => {
        phone.held.set(key, value)
        return Promise.resolve(true)
      },
    }
  },
}))

/** The one thing that outlives a launch on the page's side. */
let jar = ''

/** The module graph, compiled once and outside anybody's budget. Every launch
 *  below re-imports the store to get a fresh one, and the first of those would
 *  otherwise pay for compiling it inside a five second test; see
 *  docs/conventions.md. */
beforeAll(async () => {
  await import('./local')
})

/** A new port, so a new origin, so an empty `localStorage`. The cookie stays.
 *
 *  Real timers while the module loads: a dynamic import is not something to run
 *  the clock over. */
async function launch() {
  vi.useRealTimers()
  vi.resetModules()

  vi.stubGlobal('document', {
    get cookie() {
      return jar
    },
    set cookie(one: string) {
      const [pair = ''] = one.split(';')
      const [name = ''] = pair.split('=')
      const rest = jar
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part && !part.startsWith(`${name}=`))

      jar = [...rest, pair].join('; ')
    },
  })

  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  })

  const module = await import('./local')
  vi.useFakeTimers()

  return module
}

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  jar = ''
  phone.held.clear()
  phone.reachable = true
})

describe('settings across launches', () => {
  test('a setting written in one launch is there in the next', async () => {
    const first = await launch()
    const one = first.installLocal()
    localStorage.setItem('nib:theme', 'dark')
    // The write settles rather than going out per keystroke.
    await vi.advanceTimersByTimeAsync(1000)

    const second = await launch()
    second.installLocal()

    expect(localStorage.getItem('nib:theme')).toBe('dark')
    expect(one.getItem('nib:theme')).toBe('dark')
  })

  test('it is there at the first paint, without waiting for the phone', async () => {
    const first = await launch()
    first.installLocal()
    localStorage.setItem('nib:theme', 'dark')
    await vi.advanceTimersByTimeAsync(1000)

    // The channel never arrives this launch. The cookie is synchronous, so what
    // decides the first paint is known before anything is painted.
    phone.reachable = false
    const second = await launch()
    second.installLocal()

    expect(localStorage.getItem('nib:theme')).toBe('dark')
  })

  test('what the cookie could not hold comes back from the phone', async () => {
    const first = await launch()
    first.installLocal()
    localStorage.setItem('nib:theme', 'dark')
    // Far past what a cookie will take, so only the phone app can hold it.
    localStorage.setItem('nib:layouts', 'x'.repeat(6000))
    await vi.advanceTimersByTimeAsync(1000)

    const second = await launch()
    const local = second.installLocal()
    // The small one rode the cookie and is here already.
    expect(localStorage.getItem('nib:theme')).toBe('dark')
    expect(localStorage.getItem('nib:layouts')).toBeNull()

    await second.fillLocal(local)
    expect(localStorage.getItem('nib:layouts')).toHaveLength(6000)
  })

  test('a setting changed this launch is not undone by the phone answering late', async () => {
    const first = await launch()
    first.installLocal()
    localStorage.setItem('nib:theme', 'dark')
    await vi.advanceTimersByTimeAsync(1000)

    const second = await launch()
    const local = second.installLocal()
    // Somebody changes it before the channel arrives.
    localStorage.setItem('nib:theme', 'light')

    await second.fillLocal(local)
    expect(localStorage.getItem('nib:theme')).toBe('light')
  })

  test('the page keeps working when there is no cookie and no phone', async () => {
    phone.reachable = false
    const only = await launch()
    only.installLocal()

    localStorage.setItem('nib:theme', 'dark')
    expect(localStorage.getItem('nib:theme')).toBe('dark')
    expect(localStorage.getItem('nothing')).toBeNull()
  })
})
