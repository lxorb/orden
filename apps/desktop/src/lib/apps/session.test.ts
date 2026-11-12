import { UNKNOWN_APP, type View } from '@orden/online/apps'
import { describe, expect, test, vi } from 'vitest'
import type { Tab } from '../workspace/documents.svelte'
import type { AppHeard } from './link'
import {
  ANSWER_WITHIN,
  AppSession,
  find,
  type Found,
  type Linked,
  type Look,
  lookOf,
  OPEN_DEADLINE,
  numberedBeside,
  type Read,
  readApp,
  type SessionWorld,
  unreadOf,
} from './session.svelte'

const server = vi.hoisted(() => ({ version: 1, asked: 0 }))

vi.mock('../api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api')>()
  const me = () => {
    server.asked += 1
    return Promise.resolve({
      user: { id: 'u1', email: 'me@example.com', name: null, syncVersion: server.version },
    })
  }
  return {
    ...original,
    api: new Proxy(original.api, {
      get: (target, name, receiver) =>
        name === 'me' ? me : (Reflect.get(target, name, receiver) as unknown),
    }),
  }
})

const FILE = JSON.stringify({
  v: 1,
  host: 'device-desktop',
  run: { kind: 'installed', id: 'gimp.desktop', name: 'GIMP' },
})
const VIEW: View = { width: 800, height: 600, dpr: 1, hz: 60 }
const tick = () => new Promise((settle) => setTimeout(settle, 0))

function world(
  options: {
    token?: string | null
    found?: Found
    looks?: Look[]
    reads?: Read[]
  } = {},
) {
  let clock = 0
  let timers: { at: number; run: () => void }[] = []
  const state = {
    token: options.token === undefined ? 'tok' : options.token,
    found: options.found ?? { id: 'app-1', own: true },
    finds: 0,
    looks: [...(options.looks ?? ['open'])],
    looked: 0,
    reads: 0,
    devices: [{ id: 'device-desktop', name: 'Desktop' }] as { id: string; name: string }[],
  }
  const links: { heard: (what: AppHeard) => void; said: unknown[]; closed: boolean }[] = []
  const made: SessionWorld = {
    read: () => {
      state.reads += 1
      const reads = options.reads ?? []
      return Promise.resolve((reads.length > 1 ? reads.shift() : reads[0]) ?? { text: FILE })
    },
    find: () => {
      state.finds += 1
      return Promise.resolve(state.found)
    },
    token: () => state.token,
    devices: () => Promise.resolve(state.devices),
    look: () => {
      state.looked += 1
      return Promise.resolve(
        state.looks.length > 1 ? (state.looks.shift() ?? 'open') : (state.looks[0] ?? 'open'),
      )
    },
    link: (_app, heard): Linked => {
      const one = { heard, said: [] as unknown[], closed: false }
      links.push(one)
      return {
        open: () => undefined,
        close: () => {
          one.closed = true
        },
        say: (frame) => {
          one.said.push(frame)
          return true
        },
        take: () => true,
        resize: () => undefined,
      }
    },
    after: (ms, run) => {
      const timer = { at: clock + ms, run }
      timers.push(timer)
      return () => {
        timers = timers.filter((one) => one !== timer)
      }
    },
    now: () => clock,
  }
  async function pass(ms: number) {
    const until = clock + ms
    for (;;) {
      const due = timers.filter((one) => one.at <= until).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      timers = timers.filter((one) => one !== due)
      clock = due.at
      due.run()
      await tick()
    }
    clock = until
    await tick()
  }
  const tab = { id: 'tab-1', path: '/s/GIMP.application' } as unknown as Tab
  const session = new AppSession(tab, made)
  return { session, state, links, pass }
}

describe('an application tab connecting', () => {
  test('reads what a look at the door answered', () => {
    expect(lookOf(426, 'an application is a websocket')).toBe('open')
    expect(lookOf(401, 'sign in first')).toBe('signed-out')
    expect(lookOf(404, UNKNOWN_APP)).toBe('unknown')
    expect(lookOf(404, 'not found')).toBe('unserved')
    expect(lookOf(404, null)).toBe('unserved')
    expect(lookOf(503, null)).toBe('unreachable')
    expect(lookOf(null, null)).toBe('unreachable')
  })

  test('says an account that serves no applications at once, and makes no socket', async () => {
    const { session, links, pass, state } = world({ looks: ['unserved'] })
    await session.start(VIEW)
    expect(session.status).toEqual({ is: 'unserved' })
    expect(links).toEqual([])
    await pass(120_000)
    expect(state.looked).toBe(1)
    state.looks = ['open']
    session.retry()
    await tick()
    expect(links).toHaveLength(1)
  })

  test('signed out, it says so, and connects once signed in again', async () => {
    const { session, links, state } = world({ token: null })
    await session.start(VIEW)
    expect(session.status).toEqual({ is: 'signed-out' })
    state.token = 'tok'
    session.retry()
    await tick()
    expect(links).toHaveLength(1)
    expect(session.status).toEqual({ is: 'connecting' })
  })

  test('a tab opened before sync runs says so, and connects by itself once sync gives the id', async () => {
    const { session, links, state, pass } = world({ found: { none: 'not-running' } })
    await session.start(VIEW)
    expect(session.status).toEqual({ is: 'not-running' })
    state.found = { id: 'app-1', own: true }
    await pass(3_000)
    expect(links).toHaveLength(1)
    expect(session.status).toEqual({ is: 'connecting' })
  })

  test('a file sync has not taken in yet keeps its reason while it is looked for again', async () => {
    const { session, links, state, pass } = world({ found: { none: 'untaken' } })
    await session.start(VIEW)
    expect(session.status).toEqual({ is: 'untaken' })
    await pass(3_000)
    expect(state.finds).toBe(2)
    expect(session.status).toEqual({ is: 'untaken' })
    expect(links).toEqual([])
  })

  test('a file in a space sync does not keep says so, and is looked for again', async () => {
    const { session, links, state, pass } = world({ found: { none: 'outside' } })
    await session.start(VIEW)
    expect(session.status).toEqual({ is: 'outside' })
    state.found = { id: 'app-1', own: true }
    await pass(3_000)
    expect(links).toHaveLength(1)
  })

  test('an account still on the old sync says so, looks again by itself, and opens once it has moved', async () => {
    const { session, links, state, pass } = world({ found: { none: 'old-sync' } })
    await session.start(VIEW)
    expect(session.status).toEqual({ is: 'old-sync' })
    expect(links).toEqual([])
    state.found = { id: 'app-1', own: true }
    await pass(3_000)
    expect(state.finds).toBe(2)
    expect(links).toHaveLength(1)
  })

  test('a file in a space shared with the reader says it runs only from their own', async () => {
    const { session, links, state } = world({ found: { id: 'app-1', own: false } })
    await session.start(VIEW)
    expect(session.status).toEqual({ is: 'shared' })
    expect(state.looked).toBe(0)
    expect(links).toEqual([])
  })

  test('a file the account does not have yet is looked at again by itself until it does', async () => {
    const { session, links, pass } = world({ looks: ['unknown', 'unknown', 'open'] })
    await session.start(VIEW)
    expect(session.status).toEqual({ is: 'unsynced' })
    await pass(3_000)
    expect(links).toEqual([])
    await pass(5_000)
    expect(links).toHaveLength(1)
    expect(session.status).toEqual({ is: 'connecting' })
  })

  test('a socket that does not open in time says so, looks again, and is let in once it opens', async () => {
    const { session, links, pass, state } = world()
    await session.start(VIEW)
    expect(session.status).toEqual({ is: 'connecting' })
    await pass(OPEN_DEADLINE)
    expect(session.status).toEqual({ is: 'unreachable' })
    expect(state.looked).toBe(2)
    links[0]?.heard({ t: 'open' })
    links[0]?.heard({ t: 'host', up: false })
    expect(session.status).toEqual({ is: 'away' })
    links[0]?.heard({ t: 'host', up: true })
    links[0]?.heard({ t: 'hold' })
    expect(session.status).toMatchObject({ is: 'here', unanswered: false })
  })

  test('a socket the door stops letting in is closed, and the reason said', async () => {
    const { session, links, pass } = world({ looks: ['open', 'unserved'] })
    await session.start(VIEW)
    await pass(OPEN_DEADLINE)
    expect(session.status).toEqual({ is: 'unserved' })
    expect(links[0]?.closed).toBe(true)
  })

  test('a host the account no longer lists is said to be gone, not waited for', async () => {
    const { session, links, state } = world()
    state.devices = [{ id: 'device-laptop', name: 'Laptop' }]
    await session.start(VIEW)
    await tick()
    links[0]?.heard({ t: 'open' })
    links[0]?.heard({ t: 'host', up: false })
    expect(session.status).toEqual({ is: 'gone' })
  })

  test('a Start the host does not answer is said, and an answer clears it', async () => {
    const { session, links, pass } = world()
    await session.start(VIEW)
    const link = links[0]
    link?.heard({ t: 'open' })
    link?.heard({ t: 'hold' })
    link?.heard({ t: 'host', up: true })
    session.run('start')
    expect(link?.said).toEqual([{ t: 'run', what: 'start' }])
    await pass(ANSWER_WITHIN)
    expect(session.status).toMatchObject({ is: 'here', unanswered: true })
    link?.heard({ t: 'state', state: 'running' })
    expect(session.status).toMatchObject({ is: 'here', state: 'running', unanswered: false })
  })
})

describe('finding an application on an account that started on the old sync', () => {
  async function onOldSync(now: number) {
    const { account } = await import('../account.svelte')
    server.version = now
    server.asked = 0
    vi.doMock('../sync-client/src/runner.svelte', () => ({
      runner: { idAt: () => Promise.resolve({ id: 'app-1', own: true }) },
    }))
    account.token = 'tok'
    account.user = { id: 'u1', email: 'me@example.com', name: null, syncVersion: 1 }
    return {
      account,
      done: () => {
        vi.doUnmock('../sync-client/src/runner.svelte')
        account.token = null
        account.user = null
      },
    }
  }

  test('asks the account again, and finds the file once the account has moved', async () => {
    const { account, done } = await onOldSync(2)
    try {
      expect(await find('/Apps/GIMP.app', Date.now())).toEqual({ id: 'app-1', own: true })
      expect(server.asked).toBe(1)
      expect(account.user?.syncVersion).toBe(2)
    } finally {
      done()
    }
  })

  test('still says old sync while the account has not moved', async () => {
    const { done } = await onOldSync(1)
    try {
      expect(await find('/Apps/GIMP.app', Date.now())).toEqual({ none: 'old-sync' })
      expect(server.asked).toBe(1)
    } finally {
      done()
    }
  })
})

describe('an application file read', () => {
  test('a file that cannot be read says why, never that it is damaged', async () => {
    for (const why of ['missing', 'denied', 'locked', 'unread'] as const) {
      const { session, state } = world({ reads: [{ cannot: why }] })
      await session.start(VIEW)
      expect(session.status).toEqual({ is: 'unread', why })
      expect(state.finds).toBe(0)
    }
  })

  test('a file not on this device yet is read again by itself, and opens once it is', async () => {
    const { session, state, pass } = world({ reads: [{ cannot: 'away' }, { text: FILE }] })
    await session.start(VIEW)
    expect(session.status).toEqual({ is: 'unread', why: 'away' })
    await pass(20_000)
    expect(state.reads).toBe(2)
    expect(session.file?.host).toBe('device-desktop')
    expect(session.status.is).toBe('connecting')
  })

  test('Try again reads a file that could not be read once more', async () => {
    const { session, state } = world({ reads: [{ cannot: 'locked' }, { text: FILE }] })
    await session.start(VIEW)
    expect(session.status).toEqual({ is: 'unread', why: 'locked' })
    session.retry()
    await tick()
    await tick()
    expect(state.reads).toBe(2)
    expect(session.file?.host).toBe('device-desktop')
    expect(session.status.is).toBe('connecting')
  })

  test('a file sync numbered beside its own name is followed, and the tab points at it (#1904)', async () => {
    const { session, state } = world({ reads: [{ cannot: 'missing' }, { text: FILE }] })
    await session.start(VIEW)
    expect(state.reads).toBe(2)
    expect(session.file?.host).toBe('device-desktop')
    expect(session.status.is).toBe('connecting')
    expect((session as unknown as { tab: { path: string } }).tab.path).toBe('/s/GIMP 2.application')
    expect(numberedBeside('C:\\A\\GIMP.application').slice(0, 2)).toEqual([
      'C:\\A\\GIMP 2.application',
      'C:\\A\\GIMP 3.application',
    ])
  })

  test('only words that are no application are damaged', async () => {
    const { session } = world({ reads: [{ text: 'not json' }] })
    await session.start(VIEW)
    expect(session.status).toEqual({ is: 'damaged' })
  })

  test('names the reason in what the read was refused with', async () => {
    expect(
      unreadOf(new Error('that note is not on this device, and the account could not be reached')),
    ).toBe('away')
    expect(unreadOf('could not read C:\\A\\GIMP.application: Access is denied. (os error 5)')).toBe(
      'denied',
    )
    expect(unreadOf('could not read /s/GIMP.application: Permission denied (os error 13)')).toBe(
      'denied',
    )
    expect(
      unreadOf(
        'could not read C:\\A\\GIMP.application: The process cannot access the file because it is being used by another process. (os error 32)',
      ),
    ).toBe('locked')
    expect(
      unreadOf('could not read /s/GIMP.application: No such file or directory (os error 2)'),
    ).toBe('missing')
    expect(unreadOf(new Error('no such note'))).toBe('missing')
    expect(unreadOf('something else')).toBe('unread')
    expect(unreadOf('that note is too large')).toBeNull()
    expect(await readApp(() => Promise.reject(new Error('that note is too large')))).toEqual({
      text: '',
    })
    expect(await readApp(() => Promise.resolve(FILE))).toEqual({ text: FILE })
  })
})
