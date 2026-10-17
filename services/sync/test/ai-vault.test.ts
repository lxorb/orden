/** The AI accounts' vault: a device asking in three steps, a device with the key letting
 *  it in, a write over a newer revision refused, starting over, and nothing changed by a
 *  session that does not hold the vault key. The account only ever holds what the devices
 *  sealed; see ai/vault.ts. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { hubs } from './hub-fakes'

interface Listed {
  id: string
  name: string
  pub: string | null
  commitment: string
  nonce: string | null
  nonceFrom: string | null
  revealed: string | null
  approved: boolean
}

interface Read {
  rev: number
  blob: string | null
  wrapped: string | null
  devices: Listed[]
}

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length))

async function sha(...parts: Uint8Array[]): Promise<Uint8Array> {
  const all = new Uint8Array(parts.reduce((sum, one) => sum + one.length, 0))
  let at = 0
  for (const one of parts) {
    all.set(one, at)
    at += one.length
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', all))
}

/** A device as the app makes one, as far as the account can tell: a key it never parses,
 *  the id that key's hash names, a nonce, and the commitment to both. */
async function aDevice() {
  const pub = random(65)
  const nonce = random(32)
  const id = [...(await sha(pub)).slice(0, 16)]
    .map((one) => one.toString(16).padStart(2, '0'))
    .join('')
  return {
    id,
    pub: base64(pub),
    nonce: base64(nonce),
    commitment: base64(await sha(pub, nonce)),
  }
}

describe('the AI vault', () => {
  let env: TestEnv
  let running: ReturnType<typeof hubs>
  let token: string
  let auth: string

  beforeEach(async () => {
    env = testEnv()
    running = hubs(env)
    env.HUB = running.HUB
    token = await signIn(env, 'vault@example.com')
    auth = base64(random(32))
  })

  afterEach(() => {
    env.close()
  })

  const read = (device: string, as = token) =>
    call<Read>(env, `/v2/ai?device=${device}`, { token: as })

  const register = (one: { id: string; commitment: string }, name: string, as = token) =>
    call(env, '/v2/ai/devices', {
      token: as,
      body: { id: one.id, name, commitment: one.commitment },
    })

  const reveal = (id: string, pub: string, nonce: string, as = token) =>
    call<{ error?: string }>(env, `/v2/ai/devices/${id}/reveal`, {
      token: as,
      method: 'PUT',
      body: { pub, nonce },
    })

  /** The first device of the account: registered, revealed, the vault made with its token
   *  and the key wrapped to itself. */
  async function first() {
    const laptop = await aDevice()
    await register(laptop, 'Laptop')
    expect((await reveal(laptop.id, laptop.pub, laptop.nonce)).status).toBe(200)
    const made = await call<{ rev: number }>(env, '/v2/ai/vault', {
      token,
      method: 'PUT',
      body: { rev: 0, blob: 'c2VhbGVk', from: laptop.id, auth },
    })
    expect(made.json.rev).toBe(1)
    const wrapped = await call(env, `/v2/ai/devices/${laptop.id}/wrap`, {
      token,
      method: 'PUT',
      body: { wrapped: 'd3JhcDE', from: laptop.id, auth },
    })
    expect(wrapped.status).toBe(200)
    return laptop
  }

  test('is empty for an account that never sealed one', async () => {
    const said = await read('a'.repeat(32))
    expect(said.status).toBe(200)
    expect(said.json).toEqual({ rev: 0, blob: null, wrapped: null, devices: [] })
  })

  test('lets a device in in three steps, and carries nothing in the clear', async () => {
    const laptop = await first()

    // The phone signs in elsewhere and commits to its key.
    const phoneToken = await signIn(env, 'vault@example.com')
    const phone = await aDevice()
    await register(phone, 'Phone', phoneToken)
    expect((await read(phone.id, phoneToken)).json).toMatchObject({
      rev: 1,
      blob: 'c2VhbGVk',
      wrapped: null,
      devices: [
        { id: laptop.id, name: 'Laptop', approved: true },
        { id: phone.id, name: 'Phone', pub: null, commitment: phone.commitment, approved: false },
      ],
    })
    // Not before it is answered.
    expect((await reveal(phone.id, phone.pub, phone.nonce, phoneToken)).status).toBe(409)

    // The laptop answers, and its answer is the one that stands.
    const answer = base64(random(32))
    const answered = await call(env, `/v2/ai/devices/${phone.id}/nonce`, {
      token,
      method: 'PUT',
      body: { nonce: answer, from: laptop.id, auth },
    })
    expect(answered.status).toBe(200)

    // The phone reveals: not a key other than its id's, nor a nonce other than the one it
    // committed to.
    const other = await aDevice()
    expect((await reveal(phone.id, other.pub, phone.nonce, phoneToken)).status).toBe(400)
    expect((await reveal(phone.id, phone.pub, other.nonce, phoneToken)).status).toBe(400)
    expect((await reveal(phone.id, phone.pub, phone.nonce, phoneToken)).status).toBe(200)
    expect((await reveal(phone.id, phone.pub, phone.nonce, phoneToken)).status).toBe(409)
    expect((await read(phone.id, phoneToken)).json.devices[1]).toMatchObject({
      pub: phone.pub,
      nonce: answer,
      nonceFrom: laptop.id,
      revealed: phone.nonce,
    })

    // The laptop wraps the key to it.
    await call(env, `/v2/ai/devices/${phone.id}/wrap`, {
      token,
      method: 'PUT',
      body: { wrapped: 'd3JhcDI', from: laptop.id, auth },
    })
    expect((await read(phone.id, phoneToken)).json.wrapped).toBe('d3JhcDI')
    // Each change was said to the account's hub.
    const told = running.asked.filter((one) => one.ask === 'ai')
    expect(told.length).toBeGreaterThanOrEqual(6)
  })

  test('takes the first answer only', async () => {
    const laptop = await first()
    const phone = await aDevice()
    await register(phone, 'Phone')
    const answer = (from: string) =>
      call(env, `/v2/ai/devices/${phone.id}/nonce`, {
        token,
        method: 'PUT',
        body: { nonce: base64(random(32)), from, auth },
      })
    expect((await answer(laptop.id)).status).toBe(200)
    expect((await answer('c'.repeat(32))).status).toBe(409)
  })

  test('refuses a write over a revision another device moved past', async () => {
    await first()
    const write = (rev: number, blob: string) =>
      call<{ rev: number; error?: string }>(env, '/v2/ai/vault', {
        token,
        method: 'PUT',
        body: { rev, blob, auth },
      })
    expect((await write(1, 'dHdv')).json.rev).toBe(2)
    const stale = await write(1, 'dGhyZWU')
    expect(stale.status).toBe(409)
    expect(stale.json).toMatchObject({ error: 'stale', rev: 2 })
    expect((await write(0, 'Zm91cg')).status).toBe(409)
  })

  test('changes nothing for a session without the vault key', async () => {
    const laptop = await first()
    const phone = await aDevice()
    await register(phone, 'Phone')
    const forged = base64(random(32))
    const as = (path: string, method: string, body: unknown) =>
      call(env, path, { token, method, body })

    expect(
      (
        await as(`/v2/ai/devices/${phone.id}/nonce`, 'PUT', {
          nonce: 'bm9uY2U',
          from: phone.id,
          auth: forged,
        })
      ).status,
    ).toBe(403)
    expect(
      (await as(`/v2/ai/devices/${phone.id}/nonce`, 'PUT', { nonce: 'bm9uY2U', from: phone.id }))
        .status,
    ).toBe(403)
    expect(
      (await as(`/v2/ai/devices/${laptop.id}/wrap`, 'PUT', { wrapped: 'eA', auth: forged })).status,
    ).toBe(403)
    expect((await as('/v2/ai/vault', 'PUT', { rev: 1, blob: 'eA', auth: forged })).status).toBe(403)
    expect((await as('/v2/ai/vault', 'DELETE', { auth: forged })).status).toBe(403)
    expect((await as('/v2/ai/vault', 'DELETE', {})).status).toBe(403)
    expect((await as(`/v2/ai/devices/${laptop.id}`, 'DELETE', {})).status).toBe(403)
    expect((await read(laptop.id)).json).toMatchObject({
      rev: 1,
      blob: 'c2VhbGVk',
      wrapped: 'd3JhcDE',
      devices: [
        { id: laptop.id, approved: true },
        { id: phone.id, approved: false },
      ],
    })
  })

  test('a device that is let in keeps its key; one still asking starts its asking over', async () => {
    const laptop = await first()
    await register(laptop, 'Laptop again')
    expect((await read(laptop.id)).json).toMatchObject({
      wrapped: 'd3JhcDE',
      devices: [{ name: 'Laptop again', pub: laptop.pub, approved: true }],
    })

    const phone = await aDevice()
    await register(phone, 'Phone')
    await call(env, `/v2/ai/devices/${phone.id}/nonce`, {
      token,
      method: 'PUT',
      body: { nonce: base64(random(32)), from: laptop.id, auth },
    })
    await reveal(phone.id, phone.pub, phone.nonce)
    await register({ id: phone.id, commitment: base64(random(32)) }, 'Phone')
    expect((await read(phone.id)).json.devices[1]).toMatchObject({
      pub: null,
      nonce: null,
      nonceFrom: null,
      revealed: null,
      approved: false,
    })
  })

  test('starting over lets go of the vault and every wrap, by the key or once no device is allowed', async () => {
    const laptop = await first()
    expect(
      (await call(env, '/v2/ai/vault', { token, method: 'DELETE', body: { auth } })).status,
    ).toBe(200)
    expect((await read(laptop.id)).json).toMatchObject({
      rev: 0,
      blob: null,
      wrapped: null,
      devices: [{ id: laptop.id, approved: false }],
    })

    // With nobody allowed, any device of the account may.
    const again = await first()
    await call(env, `/v2/ai/devices/${again.id}`, { token, method: 'DELETE', body: { auth } })
    expect((await call(env, '/v2/ai/vault', { token, method: 'DELETE' })).status).toBe(200)
  })

  test('takes only what a device makes, and only from somebody signed in', async () => {
    const bad = await call(env, '/v2/ai/devices', {
      token,
      body: { id: 'not-hex', name: 'x', commitment: 'Y29tbWl0' },
    })
    expect(bad.status).toBe(400)
    expect(
      (await call(env, '/v2/ai/vault', { method: 'PUT', body: { rev: 0, blob: 'eA', auth } }))
        .status,
    ).toBe(401)
    expect(
      (await call(env, '/v2/ai/vault', { token, method: 'PUT', body: { rev: 0, blob: 'eA' } }))
        .status,
    ).toBe(403)
  })

  test('is the account’s alone', async () => {
    const laptop = await first()
    const other = await signIn(env, 'other@example.com')
    expect((await read(laptop.id, other)).json).toEqual({
      rev: 0,
      blob: null,
      wrapped: null,
      devices: [],
    })
  })
})
