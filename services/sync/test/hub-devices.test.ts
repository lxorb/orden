import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { call, type TestEnv, testEnv } from './harness'
import { computer, hangUp, type Hubs, hubs } from './hub-fakes'

interface DevicesView {
  devices: {
    id: string
    name: string
    platform: string
    app: string
    createdAt: number
    lastSeenAt: number | null
    current: boolean
  }[]
  error: string
  name: string
}
const EMAIL = 'devices@example.com'
describe('the devices', () => {
  let env: TestEnv
  let running: Hubs
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 8, 30, 12))
    env = testEnv()
    running = hubs(env)
    env.HUB = running.HUB
  })
  afterEach(() => {
    vi.useRealTimers()
    env.close()
  })
  test('are every one that said hello, with which is asking', async () => {
    const laptop = await computer(env, running, EMAIL, 'Laptop')
    await computer(env, running, EMAIL, 'Studio')
    const listed = await call<DevicesView>(env, '/v2/devices', { token: laptop.token })
    expect(listed.status).toBe(200)
    expect(
      listed.json.devices.map(({ name, platform, app, current }) => ({
        name,
        platform,
        app,
        current,
      })),
    ).toEqual([
      { name: 'Studio', platform: 'windows', app: '1.0.0', current: false },
      { name: 'Laptop', platform: 'windows', app: '1.0.0', current: true },
    ])
  })
  test('say when they were last here', async () => {
    const laptop = await computer(env, running, EMAIL, 'Laptop')
    vi.setSystemTime(Date.now() + 60_000)
    const left = Date.now()
    await hangUp(running.of(laptop.user).hub, running.of(laptop.user).state, laptop.socket)
    const other = await computer(env, running, EMAIL, 'Desktop')
    const listed = await call<DevicesView>(env, '/v2/devices', { token: other.token })
    expect(listed.json.devices.find((one) => one.id === laptop.id)?.lastSeenAt).toBe(left)
  })
  test('leave out the ones that were ended', async () => {
    const laptop = await computer(env, running, EMAIL, 'Laptop')
    const desktop = await computer(env, running, EMAIL, 'Desktop')
    await call(env, `/v1/sessions/${desktop.session}`, { method: 'DELETE', token: laptop.token })
    const listed = await call<DevicesView>(env, '/v2/devices', { token: laptop.token })
    expect(listed.json.devices.map((one) => one.id)).toEqual([laptop.id])
  })
})
