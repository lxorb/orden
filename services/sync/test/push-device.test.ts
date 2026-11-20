import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { call, type TestEnv, testEnv } from './harness'
import { type Computer, computer, connect, type HubSocket, type Hubs, hubs, send } from './hub-fakes'

let env: TestEnv
let running: Hubs
let web: Computer
let native: HubSocket
let space: string
const NATIVE = 'device-native'
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.UTC(2026, 10, 20, 12))
  env = testEnv()
  running = hubs(env)
  env.HUB = running.HUB
  web = await computer(env, running, 'owner@example.com', 'Web')
  const { hub } = running.of(web.user)
  native = connect(hub, { device: NATIVE, who: web.user, session: web.session })
  await send(hub, native, { t: 'hello', device: NATIVE, name: 'Native', platform: 'macos', app: '1.0.0' })
  vi.setSystemTime(Date.now() + 31_000)
  native.take()
  space = (env.db.prepare('select id from spaces where user_id = ?').get(web.user) as { id: string }).id
})
afterEach(() => {
  vi.useRealTimers()
  env.close()
})
const headers = (device?: string): Record<string, string> => (device ? { 'x-orden-device-id': device } : {})
async function feedDevice(device?: string): Promise<string> {
  const answer = await call<{ device: string }>(env, `/v2/spaces/${space}/feed`, {
    token: web.token,
    headers: headers(device),
  })
  return answer.json.device
}
async function written(device: string | undefined, path: string) {
  const answer = await call(env, `/v1/spaces/${space}/notes`, {
    token: web.token,
    headers: headers(device),
    body: { path, content: 'words\n' },
  })
  expect(answer.status).toBe(201)
}
const poked = (socket: HubSocket) => socket.take().filter((one) => (one as { t?: string }).t === 'poke')
describe('two devices on one session', () => {
  test('both are bound to it', () => {
    const bound = env.db
      .prepare('select id from devices where session_id = ? and revoked_at is null order by id')
      .all(web.session) as { id: string }[]
    expect(bound.map((one) => one.id)).toEqual([NATIVE, web.id])
  })
  test('a write is from the device that says it wrote it', async () => {
    expect(await feedDevice(web.id)).toBe(web.id)
    expect(await feedDevice(NATIVE)).toBe(NATIVE)
  })
  test('a write from one pokes the other and not itself', async () => {
    await written(web.id, 'From the web.md')
    expect(poked(native)).toHaveLength(1)
    expect(poked(web.socket)).toEqual([])
    await written(NATIVE, 'From the app.md')
    expect(poked(web.socket)).toHaveLength(1)
    expect(poked(native)).toEqual([])
  })
  test('a device of another account or another session is not taken on its word', async () => {
    const stranger = await computer(env, running, 'stranger@example.com', 'Stranger')
    const phone = await computer(env, running, 'owner@example.com', 'Phone')
    for (const claimed of [stranger.id, phone.id, 'device-made-up']) {
      expect([web.id, NATIVE], claimed).toContain(await feedDevice(claimed))
    }
  })
  test('a request that names no device is one of the session’s, as before', async () => {
    expect([web.id, NATIVE]).toContain(await feedDevice())
  })
  test('a revoked device is not taken on its word', async () => {
    env.db.prepare('update devices set revoked_at = 1 where id = ?').run(NATIVE)
    expect(await feedDevice(NATIVE)).toBe(web.id)
  })
})
