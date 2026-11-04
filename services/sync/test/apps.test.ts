/** An application's relay and door (issue 1063): the lock between viewers, which is the
 *  online terminal's (locks/sockets.ts), and signalling that only the holder and the host
 *  ever see. */

import { createHash } from 'node:crypto'
import { subprotocol } from '@orden/rooms'
import { HOLD_GRACE } from '@orden/online/wire'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AppRelay, type Party } from '../src/apps/relay'
import type { Env } from '../src/types'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { HubState } from './hub-fakes'
import { MachineSocket } from './machine-fakes'

let env: TestEnv
/** Whether a test made a database to close. */
let opened = false

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(Date.UTC(2026, 10, 4, 12))
})

afterEach(() => {
  vi.useRealTimers()
  if (opened) env.close()
  opened = false
})

function relay() {
  const state = new HubState()
  Object.assign(state, {
    getWebSocketAutoResponseTimestamp: (socket: MachineSocket) => socket.beatAt,
  })
  const made = new AppRelay(state as unknown as DurableObjectState, {} as Env)
  async function join(role: Party['role'], device: string): Promise<MachineSocket> {
    const socket = new MachineSocket()
    await made.enter(socket as unknown as WebSocket, {
      role,
      session: 'app-1',
      device,
      who: 'u_emil',
      name: `${device}’s screen`,
      seen: Date.now(),
    })
    return socket
  }
  const say = (socket: MachineSocket, frame: unknown) =>
    made.webSocketMessage(socket as unknown as WebSocket, JSON.stringify(frame))
  async function closed(socket: MachineSocket) {
    socket.close(1006, 'gone')
    await made.webSocketClose(socket as unknown as WebSocket)
    state.drop(socket as never)
  }
  async function viewer(device: string) {
    const socket = await join('viewer', device)
    await say(socket, {
      t: 'hello',
      hold: true,
      view: { width: 1200, height: 800, dpr: 2, hz: 120 },
    })
    return socket
  }
  return { made, state, join, say, closed, viewer }
}

describe('an application’s relay', () => {
  test('the first viewer holds it, and the host is told who and at what size', async () => {
    const { join, viewer } = relay()
    const host = await join('host', 'desktop')
    const laptop = await viewer('laptop')
    expect(laptop.of('host')).toEqual([{ t: 'host', up: true }])
    expect(laptop.of('held')).toEqual([])
    expect(host.of('viewer').at(-1)).toEqual({
      t: 'viewer',
      device: 'laptop',
      name: 'laptop’s screen',
    })
    expect(host.of('view').at(-1)).toEqual({
      t: 'view',
      view: { width: 1200, height: 800, dpr: 2, hz: 120 },
    })
  })

  test('only the holder’s signalling reaches the host, and the host’s only the holder', async () => {
    const { join, say, viewer } = relay()
    const host = await join('host', 'desktop')
    const laptop = await viewer('laptop')
    const phone = await viewer('phone')
    expect(phone.of('held')).toHaveLength(1)

    await say(phone, { t: 'signal', data: 'offer from the phone' })
    await say(phone, { t: 'run', what: 'stop' })
    expect(host.of('signal')).toEqual([])
    expect(host.of('run')).toEqual([])
    await say(laptop, { t: 'signal', data: 'offer' })
    expect(host.of('signal')).toEqual([{ t: 'signal', data: 'offer' }])

    await say(host, { t: 'signal', data: 'answer' })
    expect(laptop.of('signal')).toEqual([{ t: 'signal', data: 'answer' }])
    expect(phone.of('signal')).toEqual([])
  })

  test('Take over hands it to the new device, and the host is told to wait for its offer', async () => {
    const { join, say, viewer } = relay()
    const host = await join('host', 'desktop')
    const laptop = await viewer('laptop')
    const phone = await viewer('phone')

    await say(phone, { t: 'take' })
    expect(phone.of('hold')).toEqual([{ t: 'hold' }])
    expect(laptop.of('held').at(-1)).toMatchObject({ by: 'phone’s screen', taken: true })
    expect(host.of('viewer').at(-1)).toMatchObject({ device: 'phone' })

    await say(laptop, { t: 'signal', data: 'stale offer' })
    expect(host.of('signal')).toEqual([])
  })

  test('two Take overs at once end with one holder', async () => {
    const { say, viewer } = relay()
    await viewer('laptop')
    const phone = await viewer('phone')
    const tablet = await viewer('tablet')
    await Promise.all([say(phone, { t: 'take' }), say(tablet, { t: 'take' })])
    const holding = [phone, tablet].filter((one) => one.of('held').at(-1)?.taken !== true)
    expect(holding).toHaveLength(1)
  })

  test('a holder that crashed is let go of after the grace, and the one waiting has it', async () => {
    const { closed, viewer } = relay()
    const laptop = await viewer('laptop')
    const phone = await viewer('phone')
    await closed(laptop)
    phone.beatAt = new Date(Date.now() + HOLD_GRACE)
    await vi.advanceTimersByTimeAsync(HOLD_GRACE + 100)
    expect(phone.of('hold')).toEqual([{ t: 'hold' }])
  })

  test('the host leaving and coming back is said to every viewer; the state is kept for joiners', async () => {
    const { closed, join, say, viewer } = relay()
    const host = await join('host', 'desktop')
    const laptop = await viewer('laptop')
    await say(host, { t: 'state', state: 'running' })
    expect(laptop.of('state')).toEqual([{ t: 'state', state: 'running' }])
    await closed(host)
    expect(laptop.of('host').at(-1)).toEqual({ t: 'host', up: false })

    const again = await join('host', 'desktop')
    expect(laptop.of('host').at(-1)).toEqual({ t: 'host', up: true })
    expect(again.of('viewer').at(-1)).toMatchObject({ device: 'laptop' })
    const late = await viewer('phone')
    expect(late.of('state')).toEqual([{ t: 'state', state: 'running' }])
  })

  test('a second host replaces the first', async () => {
    const { join } = relay()
    const first = await join('host', 'desktop')
    await join('host', 'desktop')
    expect(first.closedWith?.code).toBe(4409)
  })
})

describe('an application’s door', () => {
  function namespace() {
    const asked: Headers[] = []
    return {
      asked,
      APPS: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: (_url: string, init: { headers: Record<string, string> }) => {
            asked.push(new Headers(init.headers))
            return Promise.resolve({
              webSocket: {},
              headers: new Headers(),
              body: null,
              status: 101,
            })
          },
        }),
      } as unknown as DurableObjectNamespace,
    }
  }

  const knock = (token: string, host = false) =>
    call(env, '/v2/apps/app-1/socket', {
      headers: {
        upgrade: 'websocket',
        'sec-websocket-protocol': [
          subprotocol(token),
          'nib.device.device-laptop',
          ...(host ? ['nib.role.host'] : []),
        ].join(', '),
      },
    })

  async function world(apps: DurableObjectNamespace) {
    env = testEnv({ APPS: apps })
    opened = true
    const owner = await signIn(env, 'owner@example.com')
    const other = await signIn(env, 'other@example.com')
    const id = (
      env.db.prepare('select id from users where email = ?').get('owner@example.com') as {
        id: string
      }
    ).id
    env.db
      .prepare(
        `insert into spaces (id, user_id, name, created_at, updated_at, blog_enabled)
         values ('space-1', ?, 'Mine', 1, 1, 0)`,
      )
      .run(id)
    env.db
      .prepare(
        `insert into notes (id, space_id, path, seq, updated_at, size, hash)
         values ('app-1', 'space-1', 'Figma.app', 1, 1, 0, 'h')`,
      )
      .run()
    return { owner, other }
  }

  const on = () =>
    env.db.prepare("insert into online_service (key, value) values ('apps', 'on')").run()

  test('answers 404 while switched off, as a route that does not exist', async () => {
    const { APPS } = namespace()
    const { owner } = await world(APPS)
    vi.setSystemTime(Date.now() + 31_000)
    expect((await knock(owner)).status).toBe(404)
  })

  test('lets in the owner’s devices, as host or viewer, and nobody else', async () => {
    const { APPS, asked } = namespace()
    const { owner, other } = await world(APPS)
    on()
    vi.setSystemTime(Date.now() + 31_000)

    expect((await knock(other)).status).toBe(404)
    expect(asked).toHaveLength(0)

    await knock(owner)
    await knock(owner, true)
    expect(asked.map((one) => one.get('x-nib-role'))).toEqual(['viewer', 'host'])
    expect(asked[0]?.get('x-nib-app-id')).toBe('app-1')

    env.db.prepare("update notes set deleted = 1 where id = 'app-1'").run()
    expect((await knock(owner)).status).toBe(404)
  })
})

/** What each computer has installed (step 3; apps/catalogue.ts): written by a host for
 *  itself, read by the reader's other devices, behind the door's switch. */
describe('a host’s catalogue', () => {
  const APPS = {} as unknown as DurableObjectNamespace
  const GIMP = { id: 'org.gimp.GIMP.desktop', name: 'GIMP' }

  /** A signed-in device, bound to its session as its hub's hello binds it. */
  async function device(email: string, id: string): Promise<string> {
    const token = await signIn(env, email)
    const hash = createHash('sha256').update(token).digest('hex')
    const session = env.db
      .prepare('select id, user_id from sessions where token_hash = ?')
      .get(hash) as {
      id: string
      user_id: string
    }
    env.db
      .prepare(
        `insert into devices (id, user_id, session_id, name, platform, app, created_at, last_seen_at)
         values (?, ?, ?, 'Laptop', 'linux', '1', 1, 1)`,
      )
      .run(id, session.user_id, session.id)
    return token
  }

  const on = () =>
    env.db.prepare("insert into online_service (key, value) values ('apps', 'on')").run()
  const write = (token: string, apps: unknown) =>
    call(env, '/v2/apps/catalogue', { token, method: 'PUT', body: { apps } })
  const read = (token: string, id: string) =>
    call<{ apps?: unknown }>(env, `/v2/apps/catalogue/${id}`, { token })

  beforeEach(() => {
    env = testEnv({ APPS })
    opened = true
  })

  test('answers 404 while switched off', async () => {
    const laptop = await device('owner@example.com', 'device-laptop')
    expect((await write(laptop, [GIMP])).status).toBe(404)
    expect((await read(laptop, 'device-laptop')).status).toBe(404)
  })

  test('a host writes its own, and the reader’s other devices read it by its id', async () => {
    on()
    const laptop = await device('owner@example.com', 'device-laptop')
    const phone = await device('owner@example.com', 'device-phone')
    const icon = 'data:image/png;base64,iVBORw0KGgo='
    const written = await write(laptop, [
      { ...GIMP, icon },
      { id: 'org.gimp.GIMP.desktop', name: 'GIMP again' },
      { id: 'firefox.desktop', name: 'Firefox', icon: 'data:text/html;base64,PHA+' },
      { name: 'no id' },
    ])
    expect(written.json).toEqual({ kept: 2 })

    const answered = await read(phone, 'device-laptop')
    expect(answered.json.apps).toEqual([
      { ...GIMP, icon },
      { id: 'firefox.desktop', name: 'Firefox' },
    ])
    expect((await read(phone, 'device-phone')).status).toBe(404)
  })

  test('nobody else’s, and nothing of a device that was ended', async () => {
    on()
    const laptop = await device('owner@example.com', 'device-laptop')
    const other = await device('other@example.com', 'device-other')
    await write(laptop, [GIMP])
    expect((await read(other, 'device-laptop')).status).toBe(404)

    env.db.prepare("update devices set revoked_at = 2 where id = 'device-laptop'").run()
    const phone = await device('owner@example.com', 'device-phone')
    expect((await read(phone, 'device-laptop')).status).toBe(404)
  })

  test('a session no device said hello with writes nothing', async () => {
    on()
    const token = await signIn(env, 'owner@example.com')
    expect((await write(token, [GIMP])).status).toBe(409)
  })
})
