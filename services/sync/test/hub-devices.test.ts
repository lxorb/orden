/** The account's devices: what `hello` writes down, the list, a rename, and when
 *  a device was last here. Ending one is in hub.test.ts. See hub/devices.ts. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { call, type TestEnv, testEnv } from './harness'
import { computer, hangUp, type Hubs, hubs, send } from './hub-fakes'

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

  test('keep the name the account gave them, whatever they say about themselves', async () => {
    const laptop = await computer(env, running, EMAIL, 'Laptop')
    const renamed = await call<DevicesView>(env, `/v2/devices/${laptop.id}`, {
      method: 'PATCH',
      token: laptop.token,
      body: { name: '  Emil’s ThinkPad ' },
    })
    expect(renamed.json.name).toBe('Emil’s ThinkPad')

    const { hub: made } = running.of(laptop.user)
    await send(made, laptop.socket, {
      t: 'hello',
      device: laptop.id,
      name: 'Windows desktop',
      platform: 'windows',
      app: '1.1.0',
    })

    const listed = await call<DevicesView>(env, '/v2/devices', { token: laptop.token })
    expect(listed.json.devices[0]).toMatchObject({ name: 'Emil’s ThinkPad', app: '1.1.0' })
  })

  test('refuse an empty name, and a device the account does not have', async () => {
    const laptop = await computer(env, running, EMAIL, 'Laptop')

    const empty = await call<DevicesView>(env, `/v2/devices/${laptop.id}`, {
      method: 'PATCH',
      token: laptop.token,
      body: { name: '   ' },
    })
    expect(empty.status).toBe(400)
    expect(empty.json.error).toBe('give the device a name')

    const other = await computer(env, running, 'other@example.com', 'Other')
    const theirs = await call<DevicesView>(env, `/v2/devices/${other.id}`, {
      method: 'PATCH',
      token: laptop.token,
      body: { name: 'Mine now' },
    })
    expect(theirs.status).toBe(404)
    expect(theirs.json.error).toBe('no such device')
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
    await call(env, `/v2/devices/${desktop.id}`, { method: 'DELETE', token: laptop.token })

    const listed = await call<DevicesView>(env, '/v2/devices', { token: laptop.token })
    expect(listed.json.devices.map((one) => one.id)).toEqual([laptop.id])
  })
})
