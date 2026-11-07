import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

const CHANNEL_AT = 3000

const phone = vi.hoisted(() => ({
  held: new Map<string, string>(),
  reachable: false,
  refusals: 0,
}))

vi.mock('./sdk', () => ({
  connectStore: async () => {
    while (!phone.reachable) await new Promise((resolve) => setTimeout(resolve, 50))

    return {
      read: (key: string) => Promise.resolve(phone.held.get(key) ?? ''),
      write: (key: string, value: string) => {
        if (phone.refusals > 0) {
          phone.refusals -= 1
          return Promise.resolve(false)
        }

        phone.held.set(key, value)
        return Promise.resolve(true)
      },
    }
  },
}))

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

beforeAll(async () => {
  await import('./keep')
})

async function launch() {
  vi.useRealTimers()
  vi.resetModules()
  wipeThePage()
  phone.reachable = false

  const { everywhere } = await import('./keep')

  vi.useFakeTimers()
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
  phone.refusals = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a session across two launches of a packed plugin', () => {
  test('is written to the phone app once its channel arrives', async () => {
    const { everywhere, done } = await launch()

    const writing = everywhere.write('a-token')
    await vi.advanceTimersByTimeAsync(500)
    expect(phone.held.get('orden:session')).toBeUndefined()

    await vi.advanceTimersByTimeAsync(CHANNEL_AT)
    await writing
    expect(phone.held.get('orden:session')).toBe('a-token')

    done()
  })

  test('comes back on the next launch, from the only store that kept it', async () => {
    const first = await launch()
    const writing = first.everywhere.write('a-token')
    await vi.advanceTimersByTimeAsync(CHANNEL_AT + 100)
    await writing
    first.done()

    const second = await launch()
    const reading = second.everywhere.read()
    await vi.advanceTimersByTimeAsync(CHANNEL_AT + 100)

    expect(await reading).toBe('a-token')
    second.done()
  })

  test('does not answer before the phone app has had its say', async () => {
    phone.held.set('orden:session', 'a-token')
    const { everywhere, done } = await launch()

    const reading = everywhere.read()
    let answered = false
    void reading.then(() => (answered = true))

    await vi.advanceTimersByTimeAsync(CHANNEL_AT - 500)
    expect(answered).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    expect(await reading).toBe('a-token')

    done()
  })

  test('puts a token back into the stores that lost it', async () => {
    phone.held.set('orden:session', 'a-token')
    const { everywhere, done } = await launch()

    const reading = everywhere.read()
    await vi.advanceTimersByTimeAsync(CHANNEL_AT + 100)
    expect(await reading).toBe('a-token')

    await vi.advanceTimersByTimeAsync(100)
    expect(localStorage.getItem('orden:session')).toBe('a-token')

    done()
  })

  test('keeps trying when the host refuses a write', async () => {
    phone.refusals = 2
    const { everywhere, done } = await launch()

    const writing = everywhere.write('a-token')
    await vi.advanceTimersByTimeAsync(CHANNEL_AT + 2000)
    await writing

    expect(phone.held.get('orden:session')).toBe('a-token')
    expect(phone.refusals).toBe(0)

    done()
  })

  test('says which store kept it and which lost it', async () => {
    phone.held.set('orden:session', 'a-token')
    const { everywhere, done } = await launch()
    const { read } = await import('./keep')

    const reading = everywhere.read()
    await vi.advanceTimersByTimeAsync(CHANNEL_AT + 100)
    await reading

    expect(read.get('localStorage')).toBe('nothing')
    expect(read.get('host')).toBe('a token')

    done()
  })
})
