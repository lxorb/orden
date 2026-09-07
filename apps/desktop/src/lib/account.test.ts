import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The session store on its own: what it does with a code, and the countdown
 *  beside the "send another" button. The network is stood in for, and so is
 *  the browser storage the token is kept in. */

const server = vi.hoisted(() => ({
  resendIn: 30,
  /** Set to make the code be refused. */
  refuse: false,
  /** How many of the first `me` calls fail, and how. `null` is a request that
   *  never arrived; a number is the account answering with that status. */
  meFails: 0,
  meStatus: null as number | null,
  /** How many `me` calls were made, so a retry can be counted. */
  meCalls: 0,
  /** Set to make listing the spaces fail, which is not a failed session. */
  spacesFail: false,
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
      me: () => {
        server.meCalls += 1
        if (server.meCalls <= server.meFails) {
          return Promise.reject(
            server.meStatus === null
              ? new Error('the network is not there yet')
              : new original.ApiError(server.meStatus, 'no'),
          )
        }

        return Promise.resolve({ user: { id: 'u1', email: 'me@example.com', name: null } })
      },
      listSpaces: () =>
        server.spacesFail
          ? Promise.reject(new Error('the network is not there yet'))
          : Promise.resolve({ spaces: [], deleted: [] }),
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
  server.meFails = 0
  server.meStatus = null
  server.meCalls = 0
  server.spacesFail = false

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

/** Coming back to a session that is already on this machine.
 *
 *  The bug these are about: every failure used to be read as a revoked token, so
 *  a launch that began before the network did threw the session away and asked
 *  for an emailed code instead. On a phone, where the plugin starts while the
 *  WebView is still finding its feet, that was every launch. */
describe('restoring a session', () => {
  /** Runs the whole retry ladder without waiting for it. */
  async function restore(): Promise<void> {
    vi.useFakeTimers()
    try {
      const restoring = account.restore()
      await vi.advanceTimersByTimeAsync(10_000)
      await restoring
    } finally {
      vi.useRealTimers()
    }
  }

  test('keeps a token the account could not be asked about', async () => {
    localStorage.setItem('nib:session', 'session')
    server.meFails = Infinity

    await restore()

    // Signed out for now, because there is no account to show. Not signed out
    // for good: the token is still here for the next launch.
    expect(account.signedIn).toBe(false)
    expect(localStorage.getItem('nib:session')).toBe('session')
  })

  test('settles into signed in when the first try came too early', async () => {
    localStorage.setItem('nib:session', 'session')
    server.meFails = 2

    await restore()

    expect(account.signedIn).toBe(true)
    expect(server.meCalls).toBe(3)
    expect(localStorage.getItem('nib:session')).toBe('session')
  })

  test('signs out only when the account refuses the token', async () => {
    localStorage.setItem('nib:session', 'session')
    server.meFails = Infinity
    server.meStatus = 401

    await restore()

    expect(account.signedIn).toBe(false)
    expect(localStorage.getItem('nib:session')).toBeNull()
    // Refused is refused: there is nothing a second ask would change.
    expect(server.meCalls).toBe(1)
  })

  test('keeps the session when the spaces cannot be listed', async () => {
    localStorage.setItem('nib:session', 'session')
    server.spacesFail = true

    await restore()

    expect(account.signedIn).toBe(true)
    expect(localStorage.getItem('nib:session')).toBe('session')
  })
})

/** The second store, which only the Even plugin registers: a packed plugin's
 *  page has no origin whose storage outlives a launch, so the phone app is asked
 *  to keep the token as well. */
describe('a host that keeps the token too', () => {
  function vault(held: { token: string | null }) {
    return {
      read: () => Promise.resolve(held.token),
      write: (token: string) => {
        held.token = token
        return Promise.resolve()
      },
      clear: () => {
        held.token = null
        return Promise.resolve()
      },
    }
  }

  test('signs back in from the host when the page kept nothing', async () => {
    account.alsoKeepIn(vault({ token: 'from-the-host' }))

    await account.restore()

    expect(account.token).toBe('from-the-host')
    expect(account.signedIn).toBe(true)
    // Put back where everything else here reads it, so the two agree.
    expect(localStorage.getItem('nib:session')).toBe('from-the-host')
  })

  test('says it is still looking while the stores are being asked', async () => {
    // Signed out and not known yet are different states. On a phone the stores
    // take seconds to answer, and a rail that offers a sign-in inside those
    // seconds is how a session that was there gets typed in again.
    let answer: (token: string | null) => void = () => undefined
    account.alsoKeepIn({
      read: () =>
        new Promise<string | null>((resolve) => {
          answer = resolve
        }),
      write: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    })

    const restoring = account.restore()
    await vi.waitFor(() => expect(account.restoring).toBe(true))
    expect(account.signedIn).toBe(false)

    answer('from-the-host')
    await restoring

    expect(account.restoring).toBe(false)
    expect(account.signedIn).toBe(true)
  })

  test('lets the stores decide between them, rather than the page alone', async () => {
    // The page's own storage is the one a packed plugin loses, so asking it
    // first means preferring the empty answer. The vault asks every store at
    // once and answers with whichever kept a token; which of them wins is its
    // business, and it puts the page's own first.
    localStorage.setItem('nib:session', 'session')
    account.alsoKeepIn(vault({ token: 'from-the-host' }))

    await account.restore()

    expect(account.token).toBe('from-the-host')
  })

  test('falls back to the page when there is no vault at all', async () => {
    // Which is every browser and the desktop app: nothing registers one there.
    localStorage.setItem('nib:session', 'session')

    await account.restore()

    expect(account.token).toBe('session')
  })

  test('hands a fresh token to the host, and takes it back on the way out', async () => {
    const held: { token: string | null } = { token: null }
    account.alsoKeepIn(vault(held))

    await account.verify('123456')
    await vi.waitFor(() => expect(held.token).toBe('session'))

    await account.signOut()
    await vi.waitFor(() => expect(held.token).toBeNull())
  })
})
