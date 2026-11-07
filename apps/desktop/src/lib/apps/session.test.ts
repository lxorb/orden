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
  type SessionWorld,
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

function world(options: { token?: string | null; found?: Found; looks?: Look[] } = {}) {
  let clock = 0
  let timers: { at: number; run: () => void }[] = []
  const state = {
    token: options.token === undefined ? 'tok' : options.token,
    found: options.found ?? { id: 'app-1', own: true },
    finds: 0,
    looks: [...(options.looks ?? ['open'])],
    looked: 0,
    devices: [{ id: 'device-desktop', name: 'Desktop' }] as { id: string; name: string }[],
  }
  const links: { heard: (what: AppHeard) => void; said: unknown[]; closed: boolean }[] = []
  const made: SessionWorld = {
    read: () => Promise.resolve(FILE),
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
    vi.doMock('../sync2/runner.svelte', () => ({
      runner: { idAt: () => Promise.resolve({ id: 'app-1', own: true }) },
    }))
    account.token = 'tok'
    account.user = { id: 'u1', email: 'me@example.com', name: null, syncVersion: 1 }
    return {
      account,
      done: () => {
        vi.doUnmock('../sync2/runner.svelte')
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
