import { beforeEach, describe, expect, test, vi } from 'vitest'

const server = vi.hoisted(() => ({
  resendIn: 30,
  refuse: false,
  meFails: 0,
  meStatus: null as number | null,
  meBody: null as Record<string, string> | string | null,
  meCalls: 0,
  spacesFail: false,
  meIsAGuest: false,
  handedOver: null as string | null | undefined,
  codes: 0,
  asksForSecond: false,
  asked: [] as string[],
  spacesHeld: null as Promise<void> | null,
}))

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>()

  return {
    ...original,
    api: {
      requestCode: () => {
        server.codes += 1
        return Promise.resolve({ ok: true as const, resendIn: server.resendIn })
      },
      verifyCode: (_email: string, _code: string, guest?: string) => {
        server.handedOver = guest ?? null
        server.asked.push('verifyCode')
        if (server.refuse) {
          return Promise.reject(new original.ApiError(400, 'that code is not right'))
        }

        if (server.asksForSecond) return Promise.resolve({ second: true, holding: 'held' })

        return Promise.resolve({
          token: 'session',
          user: { id: 'u1', email: 'me@example.com', name: null },
        })
      },
      verifySecond: (holding: string, _code: string) => {
        server.asked.push(`verifySecond ${holding}`)
        return server.refuse
          ? Promise.reject(new original.ApiError(400, 'that code is not right'))
          : Promise.resolve({
              token: 'session',
              user: { id: 'u1', email: 'me@example.com', name: null },
            })
      },
      me: () => {
        server.meCalls += 1
        if (server.meCalls <= server.meFails) {
          return Promise.reject(
            server.meStatus === null
              ? new Error('the network is not there yet')
              : new original.ApiError(
                  server.meStatus,
                  'no',
                  server.meBody ?? { error: 'sign in first' },
                ),
          )
        }

        return Promise.resolve(
          server.meIsAGuest
            ? { guest: { id: 'g1', name: 'Windows wren' } }
            : { user: { id: 'u1', email: 'me@example.com', name: null } },
        )
      },
      listSpaces: async () => {
        if (server.spacesFail) throw new Error('the network is not there yet')
        if (!server.spacesHeld) return { spaces: [], deleted: [] }
        await server.spacesHeld
        return { spaces: [{ id: 's1', name: 'Theirs' }], deleted: [] }
      },
      signOut: () => Promise.resolve({ ok: true as const }),
      usage: () => Promise.resolve({ used: 0, limit: 0 }),
    },
  }
})

vi.mock('./i18n.svelte', () => ({
  t: (text: string) => text,
  key: (text: string) => text,
  plural: (count: number, forms: { one?: string; other: string }) =>
    (count === 1 ? (forms.one ?? forms.other) : forms.other).replace('{count}', String(count)),
  amount: (value: number) => String(value),
  message: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}))

vi.mock('./sharing.svelte', () => ({
  sharedWithYou: { load: () => Promise.resolve() },
}))

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
let connectors: typeof import('./connectors.svelte').connectors
let usage: typeof import('./usage.svelte').usage

await import('./account.svelte')
await import('./connectors.svelte')
await import('./usage.svelte')

const REEVALUATING = 120_000

beforeEach(async () => {
  localStorage.clear()
  server.refuse = false
  server.resendIn = 30
  server.meFails = 0
  server.meStatus = null
  server.meBody = null
  server.meCalls = 0
  server.spacesFail = false
  server.meIsAGuest = false
  server.handedOver = undefined
  server.codes = 0
  server.asksForSecond = false
  server.asked.length = 0
  server.spacesHeld = null

  vi.resetModules()
  ;({ account } = await import('./account.svelte'))
  ;({ connectors } = await import('./connectors.svelte'))
  ;({ usage } = await import('./usage.svelte'))
  account.email = 'me@example.com'
}, REEVALUATING)

describe('the countdown to another code', () => {
  test('runs at one a second, however often a code is asked for', async () => {
    vi.useFakeTimers()

    try {
      await account.requestCode()
      expect(account.resendIn).toBe(30)

      await vi.advanceTimersByTimeAsync(5000)
      expect(account.resendIn).toBe(25)

      await account.requestCode()
      expect(account.resendIn).toBe(30)

      await vi.advanceTimersByTimeAsync(5000)
      expect(account.resendIn).toBe(25)
    } finally {
      vi.useRealTimers()
    }
  })

  test('sends one code however many times the form is submitted', async () => {
    await Promise.all([account.requestCode(), account.requestCode()])

    expect(server.codes).toBe(1)
    expect(account.step).toBe('code')
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
    expect(localStorage.getItem('orden:session')).toBeNull()
  })
})

describe('a code that is accepted', () => {
  test('signs in and holds syncing back until the notes here are settled', async () => {
    expect(await account.verify('123456')).toBe(true)

    expect(account.signedIn).toBe(true)
    expect(account.settling).toBe(true)
    expect(account.syncable).toBe(false)
    expect(localStorage.getItem('orden:session')).toBe('session')

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
    expect(localStorage.getItem('orden:session')).toBeNull()
  })

  test('a listing of spaces that comes back after signing out is not kept', async () => {
    await account.verify('123456')
    account.settled()
    let release: () => void = () => undefined
    server.spacesHeld = new Promise((done) => (release = done))

    const loading = account.loadSpaces().catch(() => undefined)
    await account.signOut()
    release()
    await loading

    expect(account.spaces).toEqual([])
    expect(account.listed).toBe(false)
  })

  test('signing out takes what was read for that account with it', async () => {
    await account.verify('123456')
    account.settled()

    connectors.freshToken = 'mcp-secret'
    connectors.clients = [
      { id: 'c1', name: 'Claude', readOnly: true, createdAt: 0, lastUsedAt: null },
    ]
    connectors.token = { exists: true, readOnly: true, lastUsedAt: null }
    usage.used = 900
    usage.limit = 1000
    usage.dismissed = true
    usage.full = true

    await account.signOut()

    expect(connectors.freshToken).toBeNull()
    expect(connectors.clients).toEqual([])
    expect(connectors.token).toBeNull()
    expect(usage.limit).toBe(0)
    expect(usage.full).toBe(false)
    expect(usage.warning).toBe(false)
  })
})

describe('the storage warning', () => {
  test('shows while sync hears the account has no room for a file, even dismissed before', () => {
    usage.used = 100
    usage.limit = 1000
    usage.dismissed = true
    expect(usage.warning).toBe(false)

    usage.syncFull(true)
    expect(usage.warning).toBe(true)
    usage.dismissed = true
    usage.syncFull(true)
    expect(usage.warning).toBe(false)

    usage.syncFull(false)
    usage.dismissed = false
    expect(usage.warning).toBe(false)
  })
})

describe('six digits, on whichever half of the sign-in', () => {
  test('are the emailed code while that is what is being asked for', async () => {
    expect(account.step).toBe('email')
    expect(await account.code('123456')).toBe(true)

    expect(server.asked).toEqual(['verifyCode'])
    expect(account.signedIn).toBe(true)
  })

  test('and the code out of the app once the account has asked for one', async () => {
    server.asksForSecond = true
    expect(await account.code('123456')).toBe(false)
    expect(account.step).toBe('second')
    expect(account.signedIn).toBe(false)

    server.asksForSecond = false
    expect(await account.code('654321')).toBe(true)

    expect(server.asked).toEqual(['verifyCode', 'verifySecond held'])
    expect(account.signedIn).toBe(true)
  })

  test('and a refused one leaves the second half where it was, to try again', async () => {
    server.asksForSecond = true
    await account.code('123456')

    server.asksForSecond = false
    server.refuse = true
    expect(await account.code('000000')).toBe(false)

    expect(account.step).toBe('second')
    expect(account.signedIn).toBe(false)
    expect(server.asked).toEqual(['verifyCode', 'verifySecond held'])
  })
})

describe('restoring a session', () => {
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

  test('has looked for the session once its token is read, before the account answers', async () => {
    localStorage.setItem('orden:session', 'session')
    server.meFails = Infinity

    vi.useFakeTimers()
    try {
      const restoring = account.restore()
      await account.looked
      expect(account.token).toBe('session')
      expect(account.signedIn).toBe(false)
      await vi.advanceTimersByTimeAsync(10_000)
      await restoring
    } finally {
      vi.useRealTimers()
    }
  })

  test('keeps a token the account could not be asked about', async () => {
    localStorage.setItem('orden:session', 'session')
    server.meFails = Infinity

    await restore()

    expect(account.signedIn).toBe(false)
    expect(localStorage.getItem('orden:session')).toBe('session')
  })

  test('settles into signed in when the first try came too early', async () => {
    localStorage.setItem('orden:session', 'session')
    server.meFails = 2

    await restore()

    expect(account.signedIn).toBe(true)
    expect(server.meCalls).toBe(3)
    expect(localStorage.getItem('orden:session')).toBe('session')
  })

  test('signs in later in the same launch once the account can be reached again', async () => {
    localStorage.setItem('orden:session', 'session')
    server.meFails = 6

    vi.useFakeTimers()
    try {
      const restoring = account.restore()
      await vi.advanceTimersByTimeAsync(10_000)
      await restoring
      expect(account.signedIn).toBe(false)

      await vi.advanceTimersByTimeAsync(5 * 60_000)
      expect(account.signedIn).toBe(true)
      expect(account.user?.id).toBe('u1')
      const asked = server.meCalls

      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(server.meCalls).toBe(asked)
    } finally {
      vi.useRealTimers()
    }
  })

  test('stops asking about a session that was signed out meanwhile', async () => {
    localStorage.setItem('orden:session', 'session')
    server.meFails = Infinity

    vi.useFakeTimers()
    try {
      const restoring = account.restore()
      await vi.advanceTimersByTimeAsync(10_000)
      await restoring
      await account.signOut()
      const asked = server.meCalls
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(server.meCalls).toBe(asked)
      expect(account.signedIn).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  test('signs out only when the account refuses the token', async () => {
    localStorage.setItem('orden:session', 'session')
    server.meFails = Infinity
    server.meStatus = 401

    await restore()

    expect(account.signedIn).toBe(false)
    expect(localStorage.getItem('orden:session')).toBeNull()
    expect(server.meCalls).toBe(1)
  })

  test.each([
    [401, '<html>blocked</html>'],
    [403, '<html>Attention Required! | Cloudflare</html>'],
    [403, { error: 'that is not something a token can do' }],
  ])('keeps the session when something in the way answers %i', async (status, body) => {
    localStorage.setItem('orden:session', 'session')
    server.meFails = Infinity
    server.meStatus = status
    server.meBody = body

    await restore()

    expect(account.signedIn).toBe(false)
    expect(account.token).toBe('session')
    expect(localStorage.getItem('orden:session')).toBe('session')
  })

  test('asks the account before ending a session sync was refused for', async () => {
    localStorage.setItem('orden:session', 'session')
    await restore()
    expect(account.signedIn).toBe(true)

    const asked = server.meCalls
    expect(account.signedOutBy(new Error('offline'))).toBe(false)
    expect(account.signedOutBy(Object.assign(new Error('blocked'), { status: 401 }))).toBe(true)
    await vi.waitFor(() => expect(server.meCalls).toBe(asked + 1))
    expect(account.signedIn).toBe(true)

    server.meFails = Infinity
    server.meStatus = 401
    expect(account.signedOutBy(Object.assign(new Error('ended'), { status: 401 }))).toBe(true)
    await vi.waitFor(() => expect(account.token).toBeNull())
    expect(localStorage.getItem('orden:session')).toBeNull()
  })

  test('keeps the session when the spaces cannot be listed', async () => {
    localStorage.setItem('orden:session', 'session')
    server.spacesFail = true

    await restore()

    expect(account.signedIn).toBe(true)
    expect(localStorage.getItem('orden:session')).toBe('session')
  })
})

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
    expect(localStorage.getItem('orden:session')).toBe('from-the-host')
  })

  test('says it is still looking while the stores are being asked', async () => {
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
    localStorage.setItem('orden:session', 'session')
    account.alsoKeepIn(vault({ token: 'from-the-host' }))

    await account.restore()

    expect(account.token).toBe('from-the-host')
  })

  test('falls back to the page when there is no vault at all', async () => {
    localStorage.setItem('orden:session', 'session')

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

describe('a session a share link handed out', () => {
  test('is a guest: signed in, with no account behind it', async () => {
    server.meIsAGuest = true
    localStorage.setItem('orden:session', 'guest-session')

    await account.restore()

    expect(account.signedIn).toBe(true)
    expect(account.guest?.name).toBe('Windows wren')
    expect(account.user).toBeNull()
    expect(account.accountToken).toBeNull()
    expect(account.name).toBe('Windows wren')
  })

  test('hands itself to the sign-in, so what a link lent it follows it in', async () => {
    server.meIsAGuest = true
    localStorage.setItem('orden:session', 'guest-session')
    await account.restore()

    expect(await account.verify('123456')).toBe(true)

    expect(server.handedOver).toBe('guest-session')
    expect(account.guest).toBeNull()
    expect(account.user?.email).toBe('me@example.com')
    expect(account.accountToken).toBe('session')
  })

  test('is not handed over by a sign-in that was nobody', async () => {
    expect(await account.verify('123456')).toBe(true)
    expect(server.handedOver).toBeNull()
  })

  test('arrives from a link rather than from a code, and asks nothing', async () => {
    await account.arrive('guest-session', { guest: { id: 'g1', name: 'iPhone lark' } })

    expect(account.signedIn).toBe(true)
    expect(localStorage.getItem('orden:session')).toBe('guest-session')
    expect(account.settling).toBe(false)
    expect(account.syncable).toBe(true)
  })

  test('holds syncing back when the link opened an account instead', async () => {
    await account.arrive('session', { user: { id: 'u1', email: 'ada@example.com', name: null } })

    expect(account.settling).toBe(true)
    expect(account.syncable).toBe(false)
    expect(account.accountToken).toBe('session')
  })

  test('opened as another account takes what was read for the last one with it', async () => {
    await account.verify('123456')
    account.settled()
    usage.limit = 1000
    usage.full = true
    connectors.freshToken = 'mcp-secret'

    await account.arrive('other-session', {
      user: { id: 'u2', email: 'ada@example.com', name: null },
    })

    expect(usage.limit).toBe(0)
    expect(usage.full).toBe(false)
    expect(connectors.freshToken).toBeNull()
    expect(account.user?.id).toBe('u2')
    expect(account.accountToken).toBe('other-session')
    expect(localStorage.getItem('orden:session')).toBe('other-session')
  })

  test('opened as the same account, or a guest signing in, keeps what was read', async () => {
    await account.verify('123456')
    account.settled()
    usage.limit = 1000

    await account.arrive('session', { user: { id: 'u1', email: 'me@example.com', name: null } })
    expect(usage.limit).toBe(1000)

    await account.signOut()
    await account.arrive('guest-session', { guest: { id: 'g1', name: 'iPhone lark' } })
    usage.limit = 500
    await account.arrive('session', { user: { id: 'u1', email: 'me@example.com', name: null } })
    expect(usage.limit).toBe(500)
  })

  test('is nobody again once the session is let go of', async () => {
    server.meIsAGuest = true
    localStorage.setItem('orden:session', 'guest-session')
    await account.restore()

    await account.signOut()

    expect(account.guest).toBeNull()
    expect(account.signedIn).toBe(false)
    expect(account.name).toBeNull()
  })
})
