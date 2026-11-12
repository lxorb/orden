import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { sha256 } from '../src/sync-server/src/crypto'
import { readFrame } from '../src/sync-server/src/hub/frames'
import { call, type ShareView, signIn, type TestEnv, testEnv } from './harness'
import { computer, connect, hub, type Hubs, hubs, send } from './hub-fakes'

const T0 = Date.UTC(2026, 8, 30, 12)
const KEY = 'k'.repeat(43)

const at = (ms: number) => vi.setSystemTime(T0 + ms)

describe('a hub socket', () => {
  test('asks the runtime to answer beats without waking the hub', () => {
    const env = testEnv()
    const { state } = hub(env)
    expect(state.autoResponse).toEqual({ request: 'beat', response: 'ok' })
    env.close()
  })

  test('reads no time off a frame', () => {
    expect(readFrame(JSON.stringify({ t: 'idle', since: 5 }))).toEqual({ t: 'idle' })
    expect(readFrame(JSON.stringify({ t: 'active', at: 1 }))).toEqual({ t: 'active' })
    expect(readFrame('beat')).toBeNull()
  })

  test('drops what a device from before #393 asks of web logins, and takes its hello', () => {
    for (const frame of [
      { t: 'acquire', key: KEY, take: true },
      { t: 'release', key: KEY },
      { t: 'flushed', key: KEY },
      { t: 'want-key', commitment: KEY },
      { t: 'want-key', pub: KEY },
      { t: 'grant-key', to: 'device-laptop', wrapped: KEY, generation: 1 },
    ]) {
      expect(readFrame(JSON.stringify(frame)), frame.t).toBeNull()
    }

    const hello = { t: 'hello', device: 'device-laptop', name: 'Laptop', platform: 'windows' }
    expect(readFrame(JSON.stringify({ ...hello, app: '0.15.0', pub: KEY }))).toEqual({
      ...hello,
      app: '0.15.0',
    })
  })
})

describe('ending a device', () => {
  let env: TestEnv
  let running: Hubs

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    at(0)
    env = testEnv()
    running = hubs(env)
    env.HUB = running.HUB
  })

  afterEach(() => {
    vi.useRealTimers()
    env.close()
  })

  test('closes its socket and ends its session', async () => {
    const laptop = await computer(env, running, 'end@example.com', 'Laptop')
    const desktop = await computer(env, running, 'end@example.com', 'Desktop')

    const ended = await call(env, `/v2/devices/${laptop.id}`, {
      method: 'DELETE',
      token: desktop.token,
    })
    expect(ended.status).toBe(200)

    expect(laptop.socket.closedWith).toEqual({ code: 1008, reason: 'this device was signed out' })
    expect(desktop.socket.closedWith).toBeNull()
    expect((await call(env, '/v1/me', { token: laptop.token })).status).toBe(401)
  })

  test('takes the web key wrapped to it, and only that one', async () => {
    const laptop = await computer(env, running, 'keys@example.com', 'Laptop')
    const desktop = await computer(env, running, 'keys@example.com', 'Desktop')
    const wrap = env.db.prepare(
      `insert into web_keys (user_id, device_id, wrapped, generation) values (?, ?, 'w', 1)`,
    )
    wrap.run(laptop.user, laptop.id)
    wrap.run(desktop.user, desktop.id)

    const ended = await call(env, `/v2/devices/${laptop.id}`, {
      method: 'DELETE',
      token: desktop.token,
    })
    expect(ended.status).toBe(200)

    expect(
      env.db.prepare('select device_id as device from web_keys where user_id = ?').all(laptop.user),
    ).toEqual([{ device: desktop.id }])
  })

  test('is what ending its session from the sessions list does', async () => {
    const laptop = await computer(env, running, 'list@example.com', 'Laptop')
    const desktop = await computer(env, running, 'list@example.com', 'Desktop')

    const ended = await call(env, `/v1/sessions/${laptop.session}`, {
      method: 'DELETE',
      token: desktop.token,
    })
    expect(ended.status).toBe(200)

    expect(laptop.socket.closedWith?.code).toBe(1008)
    expect(
      env.db
        .prepare('select revoked_at is not null as ended from devices where id = ?')
        .get(laptop.id),
    ).toEqual({ ended: 1 })
  })

  test('is what ending every other session does, and signing out', async () => {
    const laptop = await computer(env, running, 'all@example.com', 'Laptop')
    const desktop = await computer(env, running, 'all@example.com', 'Desktop')
    const tablet = await computer(env, running, 'all@example.com', 'Tablet')

    const others = await call(env, '/v1/sessions', { method: 'DELETE', token: tablet.token })
    expect(others.status).toBe(200)
    expect(laptop.socket.closedWith?.code).toBe(1008)
    expect(desktop.socket.closedWith?.code).toBe(1008)
    expect(tablet.socket.closedWith).toBeNull()

    const out = await call(env, '/v1/auth/signout', { method: 'POST', token: tablet.token })
    expect(out.status).toBe(200)
    expect(tablet.socket.closedWith?.code).toBe(1008)
  })

  test('reaches a session that signed in while every other one was being ended', async () => {
    const laptop = await computer(env, running, 'late@example.com', 'Laptop')
    const tablet = await computer(env, running, 'late@example.com', 'Tablet')
    const hide = env.db.prepare('update sessions set user_id = ?1 where id = ?2')
    env.justBefore(/select id, token_hash from sessions/, () => {
      hide.run('elsewhere', laptop.session)
      env.justBefore(/delete from sessions/, () => hide.run(tablet.user, laptop.session))
    })

    const others = await call<{ ended: number }>(env, '/v1/sessions', {
      method: 'DELETE',
      token: tablet.token,
    })
    expect(others.json.ended).toBe(1)
    expect(laptop.socket.closedWith?.code).toBe(1008)
  })

  test('stays ended when a socket of the ended session got in just after and says hello', async () => {
    const laptop = await computer(env, running, 'after@example.com', 'Laptop')
    const desktop = await computer(env, running, 'after@example.com', 'Desktop')
    await call(env, `/v1/sessions/${laptop.session}`, { method: 'DELETE', token: desktop.token })

    const { hub: made } = running.of(laptop.user)
    const late = connect(made, { device: laptop.id, who: laptop.user, session: laptop.session })
    await send(made, late, {
      t: 'hello',
      device: laptop.id,
      name: 'Laptop',
      platform: 'windows',
      app: '1.0.0',
    })

    expect(late.closedWith?.code).toBe(1008)
    expect(
      env.db
        .prepare('select revoked_at is not null as ended from devices where id = ?')
        .get(laptop.id),
    ).toEqual({ ended: 1 })
  })

  test('is what signing out does to a socket that never said hello', async () => {
    const token = await signIn(env, 'quiet@example.com')
    const user = (await call(env, '/v1/me', { token })).json.user.id
    const { id: session } = env.db
      .prepare('select id from sessions where token_hash = ?')
      .get(await sha256(token)) as { id: string }
    const socket = connect(running.of(user).hub, { device: 'device-quiet', who: user, session })

    await call(env, '/v1/auth/signout', { method: 'POST', token })
    expect(socket.closedWith?.code).toBe(1008)
  })

  test('is what a guest signing out does, to that one sign-in', async () => {
    const owner = await signIn(env, 'host@example.com')
    const space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Shared' } })).json
      .space.id
    const { json } = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'open' },
    })
    const link = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')?.[1] ?? ''
    const joined = await call(env, `/v1/join/${link}`, {
      method: 'POST',
      body: { device: 'Windows' },
    })
    const guest: string = joined.json.guest.id
    const token: string = joined.json.token

    const hub = running.of(guest).hub
    const socket = connect(hub, {
      device: 'device-guest',
      who: guest,
      guest: true,
      session: await sha256(token),
    })
    const elsewhere = connect(hub, {
      device: 'device-other',
      who: guest,
      guest: true,
      session: await sha256('another sign-in'),
    })

    await call(env, '/v1/auth/signout', { method: 'POST', token })

    expect(socket.closedWith?.code).toBe(1008)
    expect(elsewhere.closedWith).toBe(null)

    const late = connect(hub, {
      device: 'device-late',
      who: guest,
      guest: true,
      session: await sha256(token),
    })
    await send(hub, late, {
      t: 'hello',
      device: 'device-late',
      name: 'Firefox',
      platform: 'web',
      app: '1.0.0',
    })
    expect(late.closedWith?.code).toBe(1008)
  })

  test('is unknown for a device the account does not have', async () => {
    const token = await signIn(env, 'none@example.com')
    const answer = await call(env, '/v2/devices/device-nobody', { method: 'DELETE', token })
    expect(answer.status).toBe(404)
    expect(answer.json.error).toBe('no such device')
  })
})
