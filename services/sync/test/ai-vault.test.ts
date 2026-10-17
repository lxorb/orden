/** The AI accounts' vault: what a device registers, a device allowing another, a write
 *  over a newer revision refused, starting over, and the hub told of each. The account
 *  only ever holds what the devices sealed; see ai/vault.ts. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { hubs } from './hub-fakes'

interface Read {
  rev: number
  blob: string | null
  wrapped: string | null
  devices: { id: string; name: string; pub: string; approved: boolean }[]
}

const LAPTOP = 'a'.repeat(32)
const PHONE = 'b'.repeat(32)

describe('the AI vault', () => {
  let env: TestEnv
  let running: ReturnType<typeof hubs>
  let token: string

  beforeEach(async () => {
    env = testEnv()
    running = hubs(env)
    env.HUB = running.HUB
    token = await signIn(env, 'vault@example.com')
  })

  afterEach(() => {
    env.close()
  })

  const read = (device: string, as = token) =>
    call<Read>(env, `/v2/ai?device=${device}`, { token: as })

  test('is empty for an account that never sealed one', async () => {
    const said = await read(LAPTOP)
    expect(said.status).toBe(200)
    expect(said.json).toEqual({ rev: 0, blob: null, wrapped: null, devices: [] })
  })

  test('carries a key from the first device to one it allows, and nothing in the clear', async () => {
    await call(env, '/v2/ai/devices', {
      token,
      body: { id: LAPTOP, name: 'Laptop', pub: 'cHViMQ' },
    })
    await call(env, `/v2/ai/devices/${LAPTOP}/wrap`, {
      token,
      method: 'PUT',
      body: { wrapped: 'd3JhcDE', from: LAPTOP },
    })
    const sealed = await call<{ rev: number }>(env, '/v2/ai/vault', {
      token,
      method: 'PUT',
      body: { rev: 0, blob: 'c2VhbGVk', from: LAPTOP },
    })
    expect(sealed.json.rev).toBe(1)

    // The phone signs in elsewhere, says who it is, and waits.
    const phoneToken = await signIn(env, 'vault@example.com')
    await call(env, '/v2/ai/devices', {
      token: phoneToken,
      body: { id: PHONE, name: 'Phone', pub: 'cHViMg' },
    })
    expect((await read(PHONE, phoneToken)).json).toMatchObject({
      rev: 1,
      blob: 'c2VhbGVk',
      wrapped: null,
      devices: [
        { id: LAPTOP, name: 'Laptop', approved: true },
        { id: PHONE, name: 'Phone', pub: 'cHViMg', approved: false },
      ],
    })

    // The laptop allows it.
    await call(env, `/v2/ai/devices/${PHONE}/wrap`, {
      token,
      method: 'PUT',
      body: { wrapped: 'd3JhcDI', from: LAPTOP },
    })
    expect((await read(PHONE, phoneToken)).json.wrapped).toBe('d3JhcDI')
    // Each change was said to the account's hub, never as the writer's own.
    const told = running.asked.filter((one) => one.ask === 'ai')
    expect(told.length).toBeGreaterThanOrEqual(4)
  })

  test('refuses a write over a revision another device moved past', async () => {
    const write = (rev: number, blob: string) =>
      call<{ rev: number; error?: string }>(env, '/v2/ai/vault', {
        token,
        method: 'PUT',
        body: { rev, blob },
      })
    expect((await write(0, 'b25l')).json.rev).toBe(1)
    expect((await write(1, 'dHdv')).json.rev).toBe(2)
    const stale = await write(1, 'dGhyZWU')
    expect(stale.status).toBe(409)
    expect(stale.json).toMatchObject({ error: 'stale', rev: 2 })
    expect((await write(0, 'Zm91cg')).status).toBe(409)
    expect((await read(LAPTOP)).json.blob).toBe('dHdv')
  })

  test('a new public key takes the old wrap with it', async () => {
    await call(env, '/v2/ai/devices', {
      token,
      body: { id: LAPTOP, name: 'Laptop', pub: 'cHViMQ' },
    })
    await call(env, `/v2/ai/devices/${LAPTOP}/wrap`, {
      token,
      method: 'PUT',
      body: { wrapped: 'd3JhcDE' },
    })
    await call(env, '/v2/ai/devices', {
      token,
      body: { id: LAPTOP, name: 'Laptop', pub: 'cHViMQ' },
    })
    expect((await read(LAPTOP)).json.wrapped).toBe('d3JhcDE')
    await call(env, '/v2/ai/devices', { token, body: { id: LAPTOP, name: 'Laptop', pub: 'bmV3' } })
    expect((await read(LAPTOP)).json).toMatchObject({
      wrapped: null,
      devices: [{ approved: false }],
    })
  })

  test('starting over lets go of the vault and every wrap, and keeps the devices', async () => {
    await call(env, '/v2/ai/devices', {
      token,
      body: { id: LAPTOP, name: 'Laptop', pub: 'cHViMQ' },
    })
    await call(env, `/v2/ai/devices/${LAPTOP}/wrap`, {
      token,
      method: 'PUT',
      body: { wrapped: 'd3JhcDE' },
    })
    await call(env, '/v2/ai/vault', { token, method: 'PUT', body: { rev: 0, blob: 'c2VhbGVk' } })
    await call(env, '/v2/ai/vault', { token, method: 'DELETE' })
    expect((await read(LAPTOP)).json).toMatchObject({
      rev: 0,
      blob: null,
      wrapped: null,
      devices: [{ id: LAPTOP, approved: false }],
    })
  })

  test('takes only what a device makes, and only from somebody signed in', async () => {
    const bad = await call(env, '/v2/ai/devices', {
      token,
      body: { id: 'not-hex', name: 'x', pub: 'cHViMQ' },
    })
    expect(bad.status).toBe(400)
    expect(
      (await call(env, '/v2/ai/vault', { method: 'PUT', body: { rev: 0, blob: 'eA' } })).status,
    ).toBe(401)
    const nobody = await call(env, `/v2/ai/devices/${PHONE}/wrap`, {
      token,
      method: 'PUT',
      body: { wrapped: 'd3JhcDE' },
    })
    expect(nobody.status).toBe(404)
  })

  test('is the account’s alone', async () => {
    await call(env, '/v2/ai/vault', { token, method: 'PUT', body: { rev: 0, blob: 'c2VhbGVk' } })
    const other = await signIn(env, 'other@example.com')
    expect((await read(LAPTOP, other)).json.blob).toBeNull()
  })
})
