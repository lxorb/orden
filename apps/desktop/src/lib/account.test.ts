import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The session store on its own: what it does with a code, and the countdown
 *  beside the "send another" button. The network is stood in for, and so is
 *  the browser storage the token is kept in. */

const server = vi.hoisted(() => ({
  resendIn: 30,
  /** Set to make the code be refused. */
  refuse: false,
}))

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>()

  return {
    ...original,
    api: {
      requestCode: () => Promise.resolve({ ok: true as const, resendIn: server.resendIn }),
      verifyCode: () =>
        server.refuse
          ? Promise.reject(new original.ApiError(400, 'that code is not right'))
          : Promise.resolve({
              token: 'session',
              user: { id: 'u1', email: 'me@example.com', name: null },
            }),
      listSpaces: () => Promise.resolve({ spaces: [], deleted: [] }),
      signOut: () => Promise.resolve({ ok: true as const }),
    },
  }
})

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

let account: typeof import('./account.svelte').account

beforeEach(async () => {
  localStorage.clear()
  server.refuse = false
  server.resendIn = 30

  vi.resetModules()
  ;({ account } = await import('./account.svelte'))
  account.email = 'me@example.com'
})

describe('the countdown to another code', () => {
  test('runs at one a second, however often a code is asked for', async () => {
    vi.useFakeTimers()

    try {
      await account.requestCode()
      expect(account.resendIn).toBe(30)

      await vi.advanceTimersByTimeAsync(5000)
      expect(account.resendIn).toBe(25)

      // Asking again used to start a second timer beside the first, and the
      // two together took a second off twice a second.
      await account.requestCode()
      expect(account.resendIn).toBe(30)

      await vi.advanceTimersByTimeAsync(5000)
      expect(account.resendIn).toBe(25)
    } finally {
      vi.useRealTimers()
    }
  })

  test('stops once there is nothing left to wait for', async () => {
    vi.useFakeTimers()

    try {
      server.resendIn = 2
      await account.requestCode()

      await vi.advanceTimersByTimeAsync(10_000)
      expect(account.resendIn).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a code that is refused', () => {
  test('leaves the sheet open with something to read', async () => {
    server.refuse = true

    expect(await account.verify('000000')).toBe(false)
    expect(account.signedIn).toBe(false)
    expect(account.error).toBe('that code is not right')
    expect(localStorage.getItem('nib:session')).toBeNull()
  })
})

describe('a code that is accepted', () => {
  test('signs in and holds syncing back until the notes here are settled', async () => {
    expect(await account.verify('123456')).toBe(true)

    expect(account.signedIn).toBe(true)
    expect(account.settling).toBe(true)
    expect(account.syncable).toBe(false)
    expect(localStorage.getItem('nib:session')).toBe('session')

    account.settled()
    expect(account.syncable).toBe(true)
  })

  test('signing out forgets the session and everything about it', async () => {
    await account.verify('123456')
    account.settled()

    await account.signOut()

    expect(account.signedIn).toBe(false)
    expect(account.token).toBeNull()
    expect(account.spaces).toEqual([])
    expect(localStorage.getItem('nib:session')).toBeNull()
  })
})
