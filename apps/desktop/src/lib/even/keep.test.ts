import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Two launches of a packed plugin, with the phone app behaving as it does on a
 *  device: the channel is not on the page when the plugin's first line runs, it
 *  arrives seconds later, and the phone app's own store is the only one that
 *  remembers anything between launches.
 *
 *  This is the shape of the bug Emil kept hitting. Every store the page owns is
 *  wiped between launches, so a session restored from them is no session at all;
 *  the one store that keeps it cannot answer until the channel is there; and a
 *  plugin that decides "signed out" before it has an answer asks for an emailed
 *  code that was never needed. */

/** How long after the page the channel turns up. Between two and five seconds is
 *  what the platform's own guidance describes; this sits in the middle. */
const CHANNEL_AT = 3000

/** The phone app's store, which survives a launch because the phone app does. */
const phone = vi.hoisted(() => ({ held: new Map<string, string>(), reachable: false }))

vi.mock('./sdk', () => ({
  connectStore: async () => {
    // The same wait the glasses use: nothing is answered until the channel is
    // on the page.
    while (!phone.reachable) await new Promise((resolve) => setTimeout(resolve, 50))

    return {
      read: (key: string) => Promise.resolve(phone.held.get(key) ?? ''),
      write: (key: string, value: string) => {
        phone.held.set(key, value)
        return Promise.resolve(true)
      },
    }
  },
}))

/** Everything the page itself owns, wiped between launches the way a packed
 *  plugin's WebView wipes it. */
function wipeThePage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  })
  vi.stubGlobal('document', { cookie: '' })
}

/** A launch: fresh modules, a fresh page, and a channel that arrives late. */
async function launch() {
  vi.resetModules()
  wipeThePage()
  phone.reachable = false

  const { everywhere } = await import('./keep')
  const arriving = setTimeout(() => (phone.reachable = true), CHANNEL_AT)

  return {
    everywhere,
    done: () => {
      clearTimeout(arriving)
    },
  }
}

beforeEach(() => {
  phone.held.clear()
  vi.useFakeTimers()
})

describe('a session across two launches of a packed plugin', () => {
  test('is written to the phone app once its channel arrives', async () => {
    const { everywhere, done } = await launch()

    const writing = everywhere.write('a-token')
    // Before the channel: nothing is in the phone app yet, and the write is
    // still outstanding rather than lost.
    await vi.advanceTimersByTimeAsync(500)
    expect(phone.held.get('nib:session')).toBeUndefined()

    await vi.advanceTimersByTimeAsync(CHANNEL_AT)
    await writing
    expect(phone.held.get('nib:session')).toBe('a-token')

    done()
    vi.useRealTimers()
  })

  test('comes back on the next launch, from the only store that kept it', async () => {
    const first = await launch()
    const writing = first.everywhere.write('a-token')
    await vi.advanceTimersByTimeAsync(CHANNEL_AT + 100)
    await writing
    first.done()

    // A second launch: the page's own stores are empty, as they are on a device.
    const second = await launch()
    const reading = second.everywhere.read()
    await vi.advanceTimersByTimeAsync(CHANNEL_AT + 100)

    expect(await reading).toBe('a-token')
    second.done()
    vi.useRealTimers()
  })

  test('does not answer before the phone app has had its say', async () => {
    // The whole of the bug: an answer given early is "no session", and a plugin
    // that believes it puts a sign-in form in front of somebody who is signed in.
    phone.held.set('nib:session', 'a-token')
    const { everywhere, done } = await launch()

    const reading = everywhere.read()
    let answered = false
    void reading.then(() => (answered = true))

    await vi.advanceTimersByTimeAsync(CHANNEL_AT - 500)
    expect(answered).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    expect(await reading).toBe('a-token')

    done()
    vi.useRealTimers()
  })

  test('says which store kept it and which lost it', async () => {
    phone.held.set('nib:session', 'a-token')
    const { everywhere, done } = await launch()
    const { read } = await import('./keep')

    const reading = everywhere.read()
    await vi.advanceTimersByTimeAsync(CHANNEL_AT + 100)
    await reading

    // What the diagnosis panel shows, and what turns one screenshot into an
    // answer about which of the four forgot.
    expect(read.get('localStorage')).toBe('nothing')
    expect(read.get('host')).toBe('a token')

    done()
    vi.useRealTimers()
  })
})
