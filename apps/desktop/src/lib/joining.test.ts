import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

interface World {
  about: {
    kind: 'invite' | 'link'
    space: string
    role: 'write' | 'read'
    email: string | null
    asks: boolean
    from: string | null
    note?: string | null
  } | null
  through: Record<string, unknown>
  refuse: string | null
  busy: number | null
  blocked: number | null
  unreachable: boolean
  invitationDown: boolean
  asked: { key: string; options: Record<string, unknown> }[]
  shown: string | null
  passes: number
  path: string
  shared: Record<string, unknown>[]
  opened: { id: string; holding: boolean }[]
  holding: () => boolean
  withdrawn: { key: string; token: string | undefined }[]
  gate: Promise<void> | null
  withdrawFails: 'network' | number | null
}

const world = vi.hoisted((): World => ({
  about: null,
  through: {},
  refuse: null,
  busy: null,
  blocked: null,
  unreachable: false,
  invitationDown: false,
  asked: [],
  shown: null,
  passes: 0,
  path: '/',
  shared: [],
  opened: [],
  holding: () => false,
  withdrawn: [],
  gate: null,
  withdrawFails: null,
}))

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>()

  return {
    ...original,
    api: {
      invitation: () =>
        world.blocked
          ? Promise.reject(new original.ApiError(world.blocked, 'request failed', '<html>'))
          : world.invitationDown
            ? Promise.reject(new Error('the network is not there'))
            : world.about
              ? Promise.resolve(world.about)
              : Promise.reject(
                  new original.ApiError(404, 'that link has expired', {
                    error: 'that link has expired',
                  }),
                ),
      join: async (key: string, options: Record<string, unknown> = {}) => {
        world.asked.push({ key, options })
        if (world.gate) await world.gate
        if (world.unreachable) return Promise.reject(new Error('the network is not there'))
        if (world.blocked) {
          return Promise.reject(new original.ApiError(world.blocked, 'request failed', '<html>'))
        }
        if (world.refuse) {
          return Promise.reject(new original.ApiError(404, world.refuse, { error: world.refuse }))
        }
        if (world.busy) {
          const error = 'that link is busy, try again in a minute'
          return Promise.reject(new original.ApiError(world.busy, error, { error }))
        }

        return Promise.resolve(world.through)
      },
      withdraw: (key: string, token?: string) => {
        world.withdrawn.push({ key, token })
        if (world.withdrawFails === 'network') return Promise.reject(new Error('offline'))
        if (world.withdrawFails) {
          const error = 'that link has expired'
          return Promise.reject(new original.ApiError(world.withdrawFails, error, { error }))
        }
        return Promise.resolve()
      },
      signOut: () => Promise.resolve(),
      me: () => Promise.resolve({ guest: { id: 'g1', name: 'Windows wren' } }),
      listSpaces: () => Promise.resolve({ spaces: [], deleted: [] }),
      shared: () => Promise.resolve({ shared: world.shared }),
      readNote: () => Promise.resolve({ content: '{}' }),
    },
  }
})

vi.mock('./sync.svelte', () => ({
  sync: {
    pass: () => {
      world.passes += 1
      return Promise.resolve()
    },
    remoteIdFor: (root: string) => (root === '/Plans' ? 'space-1' : null),
  },
}))

vi.mock('./workspace.svelte', () => ({
  workspace: {
    spaces: [{ id: 'here', name: 'Plans', root: '/Plans' }],
    fileOps: { follow: () => () => undefined },
    showSpace: (id: string) => {
      world.shown = id
      return Promise.resolve()
    },
    showingShared: (id: string) => world.opened.some((one) => one.id === id),
    openShared: (item: { id: string }) => {
      world.opened.push({ id: item.id, holding: world.holding() })
    },
  },
}))

vi.mock('./i18n.svelte', () => ({
  t: (text: string) => text,
  message: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}))

vi.mock('./rooms/who', () => ({ deviceName: () => 'Windows' }))

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
vi.stubGlobal('window', {
  get location() {
    return { pathname: world.path }
  },
  history: {
    replaceState: (_state: unknown, _title: string, url: string) => {
      world.path = url
    },
  },
})

let joining: typeof import('./joining.svelte').joining
let account: typeof import('./account.svelte').account

await import('./joining.svelte')

const TOKEN = 'a'.repeat(64)

const space = { id: 'space-1', name: 'Plans', role: 'write' }

beforeEach(async () => {
  localStorage.clear()
  world.about = null
  world.through = {}
  world.refuse = null
  world.busy = null
  world.blocked = null
  world.unreachable = false
  world.invitationDown = false
  world.asked = []
  world.shown = null
  world.passes = 0
  world.path = `/join/${TOKEN}`
  world.shared = []
  world.opened = []
  world.withdrawn = []
  world.gate = null
  world.withdrawFails = null

  vi.resetModules()
  ;({ joining } = await import('./joining.svelte'))
  ;({ account } = await import('./account.svelte'))
  world.holding = () => !!joining.invitation
})

afterEach(() => joining.dismiss())

const invite = {
  kind: 'invite' as const,
  space: 'Plans',
  role: 'write' as const,
  email: 'ada@example.com',
  asks: false,
  from: 'Emil',
}
const open = {
  kind: 'link' as const,
  space: 'Plans',
  role: 'write' as const,
  email: null,
  asks: false,
  from: 'Emil',
}
const approval = { ...open, asks: true }

describe('a mailed invitation', () => {
  beforeEach(() => {
    world.about = invite
    world.through = {
      token: 'session',
      user: { id: 'u1', email: 'ada@example.com', name: null },
      space,
    }
  })

  test('opens the space with nothing shown and nothing asked', async () => {
    await joining.start()

    expect(joining.step).toBeNull()
    expect(account.signedIn).toBe(true)
    expect(account.user?.email).toBe('ada@example.com')
    expect(world.shown).toBe('here')
  })

  test('takes the token out of the address bar before anything else', async () => {
    await joining.start()
    expect(world.path).toBe('/')
  })

  test('brings the space down in one pass', async () => {
    await joining.start()
    expect(world.passes).toBe(1)
  })

  test('settles the notes already here before the space arrives', async () => {
    await joining.start()

    expect(account.settling).toBe(false)
    expect(account.syncable).toBe(true)
  })
})

describe('a mailed invitation to an account that asks for a second code', () => {
  beforeEach(() => {
    world.about = invite
    world.through = { second: true, holding: 'half' }
  })

  test('signs nobody in, and asks for the code out of the app', async () => {
    await joining.start()

    expect(account.signedIn).toBe(false)
    expect(account.open).toBe(true)
    expect(account.step).toBe('second')
    expect(world.shown).toBeNull()
  })

  test('and keeps the link, which the account walks through once it is in', async () => {
    await joining.start()

    world.through = { space }
    await joining.walkThrough()

    expect(world.asked.map((one) => one.key)).toEqual([TOKEN, TOKEN])
  })
})

describe('a link anybody may follow', () => {
  beforeEach(() => {
    world.about = open
    world.through = { token: 'guest-session', guest: { id: 'g1', name: 'Windows wren' }, space }
  })

  test('lands in the space as a guest, with nothing shown and nothing asked', async () => {
    await joining.start()

    expect(joining.step).toBeNull()
    expect(account.guest?.name).toBe('Windows wren')
    expect(account.user).toBeNull()
    expect(account.signedIn).toBe(true)
    expect(world.shown).toBe('here')
  })

  test('says what this device is called, so the guest has a name', async () => {
    await joining.start()
    expect(world.asked[0]?.options.device).toBe('Windows')
  })

  test('is never asked to erase the notes already on this machine', async () => {
    await joining.start()
    expect(account.settling).toBe(false)
    expect(account.syncable).toBe(true)
  })
})

describe('a link that asks first', () => {
  beforeEach(() => {
    world.about = approval
    world.through = { token: 'guest-session', guest: { id: 'g1', name: 'Ada' }, waiting: true }
  })

  test('asks one field, and nothing has been walked through yet', async () => {
    await joining.start()

    expect(joining.step).toBe('asking')
    expect(world.asked).toEqual([])
  })

  test('sends a name as a name', async () => {
    await joining.start()
    joining.told = ' Ada '
    await joining.tell()

    expect(world.asked[0]?.options.name).toBe('Ada')
    expect(world.asked[0]?.options.email).toBeUndefined()
  })

  test('sends an address as an address, which is what later claims the space', async () => {
    await joining.start()
    joining.told = 'ada@example.com'
    await joining.tell()

    expect(world.asked[0]?.options.email).toBe('ada@example.com')
    expect(world.asked[0]?.options.name).toBeUndefined()
  })

  test('asks nothing when the field is empty', async () => {
    await joining.start()
    joining.told = '  '
    await joining.tell()

    expect(world.asked).toEqual([])
  })

  test('waits on the owner, holding the session it was given', async () => {
    await joining.start()
    joining.told = 'Ada'
    await joining.tell()

    expect(joining.step).toBe('waiting')
    expect(account.guest?.name).toBe('Ada')
    expect(world.shown).toBeNull()
  })

  test('turns into the space when the owner accepts', async () => {
    await joining.start()
    joining.told = 'Ada'
    await joining.tell()

    world.through = { guest: { id: 'g1', name: 'Ada' }, space }
    await joining.walkThrough()

    expect(joining.step).toBeNull()
    expect(world.shown).toBe('here')
  })

  test('says so when the owner declines', async () => {
    await joining.start()
    joining.told = 'Ada'
    await joining.tell()

    world.through = { guest: { id: 'g1', name: 'Ada' }, declined: true }
    await joining.walkThrough()

    expect(joining.step).toBe('declined')
    expect(world.shown).toBeNull()
  })

  test('remembers the link while it waits, and forgets it once answered', async () => {
    await joining.start()
    joining.told = 'Ada'
    await joining.tell()

    expect(localStorage.getItem('orden:waiting')).toBe(TOKEN)

    world.through = { guest: { id: 'g1', name: 'Ada' }, space }
    await joining.walkThrough()
    expect(localStorage.getItem('orden:waiting')).toBeNull()
  })

  test('keeps waiting when something in the way answers instead of the account', async () => {
    await joining.start()
    joining.told = 'Ada'
    await joining.tell()

    world.blocked = 403
    await joining.walkThrough()

    expect(joining.step).toBe('waiting')
    expect(localStorage.getItem('orden:waiting')).toBe(TOKEN)
  })

  test('picks the wait back up on the next launch', async () => {
    localStorage.setItem('orden:session', 'guest-session')
    localStorage.setItem('orden:waiting', TOKEN)
    world.path = '/'

    await account.restore()
    expect(account.guest?.name).toBe('Windows wren')

    await joining.start()
    expect(joining.step).toBe('waiting')
    expect(world.asked[0]?.key).toBe(TOKEN)
    expect(world.asked[0]?.options.again).toBe(true)
    expect(joining.shown).toBe(false)
  })

  test('goes on asking after a launch whose first ask did not arrive', async () => {
    vi.useFakeTimers()
    try {
      localStorage.setItem('orden:session', 'guest-session')
      localStorage.setItem('orden:waiting', TOKEN)
      world.path = '/'
      world.unreachable = true

      await account.restore()
      await joining.start()
      expect(joining.step).toBe('waiting')

      world.unreachable = false
      const asks = world.asked.length
      await vi.advanceTimersByTimeAsync(3000)
      expect(world.asked.length).toBe(asks + 1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('waiting on the owner', () => {
  beforeEach(async () => {
    world.about = approval
    world.through = { token: 'guest-session', guest: { id: 'g1', name: 'Ada' }, waiting: true }

    await joining.start()
    joining.told = 'Ada'
    await joining.tell()
  })

  test('keeps waiting when a request never arrives', async () => {
    world.unreachable = true
    await joining.walkThrough()

    expect(joining.step).toBe('waiting')
    expect(localStorage.getItem('orden:waiting')).toBe(TOKEN)
    expect(joining.error).toBe('the network is not there')
  })

  test('is let in by the ask after the one that did not arrive', async () => {
    world.unreachable = true
    await joining.walkThrough()

    world.unreachable = false
    world.through = { guest: { id: 'g1', name: 'Ada' }, space }
    await joining.walkThrough()

    expect(joining.step).toBeNull()
    expect(world.shown).toBe('here')
  })

  test('ends when the service says the link is finished', async () => {
    world.refuse = 'that link has expired'
    await joining.walkThrough()

    expect(joining.step).toBe('gone')
    expect(localStorage.getItem('orden:waiting')).toBeNull()
  })

  test('covers the app while it is new', () => {
    expect(joining.shown).toBe(true)
  })

  test('can be closed, and goes on asking out of sight', async () => {
    joining.close()

    expect(joining.shown).toBe(false)
    expect(joining.step).toBe('waiting')
    expect(localStorage.getItem('orden:waiting')).toBe(TOKEN)

    world.through = { guest: { id: 'g1', name: 'Ada' }, space }
    await joining.walkThrough()

    expect(joining.step).toBeNull()
    expect(world.shown).toBe('here')
  })

  test('says so when the owner declines a wait that was closed', async () => {
    joining.close()
    world.through = { guest: { id: 'g1', name: 'Ada' }, declined: true }
    await joining.walkThrough()

    expect(joining.step).toBe('declined')
    expect(joining.shown).toBe(true)
  })

  test('can be cancelled, which takes the request back from the owner', async () => {
    await joining.cancel()

    expect(joining.step).toBeNull()
    expect(joining.shown).toBe(false)
    expect(localStorage.getItem('orden:waiting')).toBeNull()
    expect(world.withdrawn).toEqual([{ key: TOKEN, token: 'guest-session' }])
  })

  test('is still waiting when the request could not be taken back', async () => {
    world.withdrawFails = 'network'
    await joining.cancel()

    expect(joining.step).toBe('waiting')
    expect(joining.shown).toBe(true)
    expect(localStorage.getItem('orden:waiting')).toBe(TOKEN)
    expect(joining.error).toBe('offline')
  })

  test('is over when the link that made the request has gone', async () => {
    world.withdrawFails = 404
    await joining.cancel()

    expect(joining.step).toBeNull()
    expect(localStorage.getItem('orden:waiting')).toBeNull()
  })

  test('says it is still waiting while closed, and opens again from there', () => {
    expect(joining.aside).toBe(false)
    joining.close()
    expect(joining.aside).toBe(true)

    joining.reopen()
    expect(joining.aside).toBe(false)
    expect(joining.shown).toBe(true)
  })

  test('asks again as asking again, so a request that ran out is not made anew', async () => {
    expect(world.asked[0]?.options.again).toBeUndefined()

    await joining.walkThrough()
    expect(world.asked.at(-1)?.options.again).toBe(true)
  })

  test('stays cancelled when an ask was already on its way', async () => {
    let letGo: () => void = () => undefined
    world.gate = new Promise<void>((done) => (letGo = done))
    const asking = joining.walkThrough()

    void joining.cancel()
    world.through = { guest: { id: 'g1', name: 'Ada' }, space }
    letGo()
    await asking

    expect(joining.step).toBeNull()
    expect(joining.shown).toBe(false)
    expect(world.shown).toBeNull()
  })

  test('ends with the session it was asked under', async () => {
    await account.signOut()

    expect(joining.step).toBeNull()
    expect(localStorage.getItem('orden:waiting')).toBeNull()
  })

  test('asks once at a time, however often it is asked', async () => {
    const asks = world.asked.length
    await Promise.all([joining.walkThrough(), joining.walkThrough()])

    expect(world.asked.length).toBe(asks + 1)
  })
})

describe('the asking behind a wait', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    world.about = approval
    world.through = { token: 'guest-session', guest: { id: 'g1', name: 'Ada' }, waiting: true }

    await joining.start()
    joining.told = 'Ada'
    await joining.tell()
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(globalThis, 'document')
  })

  test('asks at once when the tab is back on screen', async () => {
    const page = Object.assign(new EventTarget(), { visibilityState: 'hidden' })
    Object.defineProperty(globalThis, 'document', { value: page, configurable: true })
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    const asks = world.asked.length
    page.visibilityState = 'visible'
    page.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)

    expect(world.asked.length).toBe(asks + 1)
  })

  test('is quick for the first minutes', async () => {
    const asks = world.asked.length
    await vi.advanceTimersByTimeAsync(60_000)

    expect(world.asked.length - asks).toBe(20)
  })

  test('is a few dozen asks in an hour, not a thousand', async () => {
    const asks = world.asked.length
    await vi.advanceTimersByTimeAsync(3_600_000)

    expect(world.asked.length - asks).toBeLessThan(90)
  })
})

describe('a link that asks first, put aside before anything is typed', () => {
  beforeEach(() => {
    world.about = approval
    world.through = { token: 'guest-session', guest: { id: 'g1', name: 'Ada' }, waiting: true }
  })

  test('keeps the name and the link for when it is opened again', async () => {
    await joining.start()
    joining.told = 'Ada'
    joining.close()

    expect(joining.shown).toBe(false)
    expect(joining.aside).toBe(true)

    joining.reopen()
    expect(joining.told).toBe('Ada')
    await joining.tell()
    expect(world.asked[0]?.key).toBe(TOKEN)
    expect(joining.step).toBe('waiting')
  })
})

describe('a link followed while the network is down', () => {
  beforeEach(() => {
    world.about = open
    world.through = { token: 'guest-session', guest: { id: 'g1', name: 'Ada' }, space }
  })

  test('says so and may be tried again when the invitation does not arrive', async () => {
    world.invitationDown = true
    await joining.start()

    expect(joining.step).toBe('unreached')
    expect(joining.error).toBe('the network is not there')
    expect(world.path).toBe('/')

    world.invitationDown = false
    await joining.retry()

    expect(joining.step).toBeNull()
    expect(joining.error).toBeNull()
    expect(world.shown).toBe('here')
  })

  test('may be tried again when the join does not arrive', async () => {
    world.unreachable = true
    await joining.start()

    expect(joining.step).toBe('unreached')
    expect(joining.error).toBe('the network is not there')

    world.unreachable = false
    await joining.retry()

    expect(joining.step).toBeNull()
    expect(world.shown).toBe('here')
  })

  test('keeps the name asked for when the ask does not arrive', async () => {
    world.about = approval
    await joining.start()
    joining.told = 'Ada'
    world.unreachable = true
    await joining.tell()

    expect(joining.step).toBe('asking')
    expect(joining.told).toBe('Ada')
    expect(joining.error).toBe('the network is not there')
  })

  test.each([429, 408])(
    'may be tried again when the link answers %i for a moment',
    async (status) => {
      world.busy = status
      await joining.start()

      expect(joining.step).toBe('unreached')
      expect(joining.error).toBe('that link is busy, try again in a minute')

      world.busy = null
      await joining.retry()

      expect(joining.step).toBeNull()
      expect(world.shown).toBe('here')
    },
  )

  test('keeps the ask open when the link is busy for a moment', async () => {
    world.about = approval
    await joining.start()
    joining.told = 'Ada'
    world.busy = 429
    await joining.tell()

    expect(joining.step).toBe('asking')
    expect(joining.told).toBe('Ada')
    expect(joining.error).toBe('that link is busy, try again in a minute')
  })

  test.each([403, 404])(
    'may be tried again when something in the way answers %i',
    async (status) => {
      world.blocked = status
      await joining.start()

      expect(joining.step).toBe('unreached')

      world.blocked = null
      await joining.retry()

      expect(joining.step).toBeNull()
      expect(world.shown).toBe('here')
    },
  )

  test('still says a refused link opens nothing', async () => {
    world.refuse = 'that link has expired'
    await joining.start()

    expect(joining.step).toBe('gone')
  })
})

describe('a link that opens nothing', () => {
  test('says one line, and the code is what is left', async () => {
    world.about = null
    await joining.start()

    expect(joining.step).toBe('gone')
    expect(account.signedIn).toBe(false)
  })

  test('says why, when the walk through is what refused', async () => {
    world.about = invite
    world.refuse = 'that invitation was sent to another address'
    await joining.start()

    expect(joining.step).toBe('gone')
    expect(joining.error).toBe('that invitation was sent to another address')
  })

  test('is gone from the screen once it has been read', async () => {
    world.about = null
    await joining.start()
    joining.dismiss()

    expect(joining.step).toBeNull()
  })
})

describe('a link in an address bar that has none', () => {
  test('does nothing at all', async () => {
    world.path = '/'
    await joining.start()

    expect(joining.step).toBeNull()
    expect(world.asked).toEqual([])
  })

  test('is not a token because it looks like one', async () => {
    world.path = '/join/not-hexadecimal'
    await joining.start()

    expect(joining.step).toBeNull()
    expect(world.asked).toEqual([])
  })
})

const board = {
  id: 'note-1',
  path: '/board.canvas',
  name: 'board',
  role: 'write',
  updatedAt: 1,
  owner: { name: 'Emil' },
  space: { id: 'space-1', name: 'Plans' },
}

describe('a link to one file, followed with no account', () => {
  beforeEach(() => {
    world.about = { ...open, note: 'board' }
    world.through = {
      token: 'guest-session',
      guest: { id: 'g1', name: 'Windows wren' },
      item: board,
    }
    world.shared = [board]
  })

  test('opens the file, and holds the link until it has', async () => {
    await joining.start()

    expect(world.opened).toEqual([{ id: 'note-1', holding: true }])
    expect(joining.invitation).toBeNull()
    expect(joining.step).toBeNull()
  })
})

describe('a guest a link gave one file to, coming back', () => {
  beforeEach(() => {
    world.path = '/'
    localStorage.setItem('orden:session', 'guest-session')
  })

  test('is back in the file, which no tab is kept of between launches', async () => {
    world.shared = [board]
    await account.restore()
    await joining.start()

    expect(world.opened.map((one) => one.id)).toEqual(['note-1'])
  })

  test('chooses from the list when there is more than one', async () => {
    world.shared = [board, { ...board, id: 'note-2', name: 'plan' }]
    await account.restore()
    await joining.start()

    expect(world.opened).toEqual([])
  })
})
