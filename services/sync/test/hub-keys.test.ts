/** The web key's relay: a new computer asks, a computer with the key approves or
 *  refuses, and the hub carries both halves without ever holding the key. See
 *  hub/keys.ts and docs/sync-v2.md section 6.6. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { grantKind } from '../src/hub/keys'
import { call, mail, type TestEnv, testEnv } from './harness'
import {
  beatAll,
  type Computer,
  computer,
  connect,
  hangUp,
  type Hubs,
  hubs,
  send,
} from './hub-fakes'

const PUB = 'P'.repeat(44)
/** The key a computer with the key answers with. */
const HOLDER = 'H'.repeat(43) + '='

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

/** A computer's key and nonce, and its commitment to both, as lib/pairing.ts makes them. */
async function aKey(): Promise<{ pub: string; nonce: string; commitment: string }> {
  const pub = crypto.getRandomValues(new Uint8Array(32))
  const nonce = crypto.getRandomValues(new Uint8Array(32))
  const both = new Uint8Array([...pub, ...nonce])
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', both))
  return { pub: base64(pub), nonce: base64(nonce), commitment: base64(digest) }
}
const WRAPPED = 'W'.repeat(140)
const KEY = 'k'.repeat(43)
const EMAIL = 'keys@example.com'

describe('the web key', () => {
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

  const hubOf = (one: Computer) => running.of(one.user).hub

  /** The new computer asks, committed. */
  async function asks(fresh: Computer) {
    const key = await aKey()
    await send(hubOf(fresh), fresh.socket, { t: 'want-key', commitment: key.commitment })
    return key
  }

  /** And is answered by `holder`, and reveals: what an Allow is then of. */
  async function asksAndReveals(fresh: Computer, holder: Computer) {
    const key = await asks(fresh)
    await send(hubOf(holder), holder.socket, {
      t: 'answer-key',
      to: fresh.id,
      nonce: 'N'.repeat(44),
      pub: HOLDER,
    })
    await send(hubOf(fresh), fresh.socket, { t: 'reveal-key', pub: key.pub, nonce: key.nonce })
    return key
  }

  /** A laptop with the key, a desktop with it too, and a new computer without. */
  async function three(): Promise<{ laptop: Computer; desktop: Computer; fresh: Computer }> {
    const laptop = await computer(env, running, EMAIL, 'Laptop')
    const desktop = await computer(env, running, EMAIL, 'Desktop')
    const fresh = await computer(env, running, EMAIL, 'Studio', false)
    beatAll(running.of(laptop.user).state)
    return { laptop, desktop, fresh }
  }

  test('asked for reaches every computer that holds it, committed, and nobody else', async () => {
    const { laptop, desktop, fresh } = await three()
    const other = await computer(env, running, EMAIL, 'Tablet', false)
    const before = env.db.prepare('select public_key from devices where id = ?').get(fresh.id)

    const key = await asks(fresh)

    const wanted = { t: 'key-wanted', device: fresh.id, name: 'Studio', commitment: key.commitment }
    expect(laptop.socket.take()).toEqual([wanted])
    expect(desktop.socket.take()).toEqual([wanted])
    expect(other.socket.take()).toEqual([])
    expect(fresh.socket.take()).toEqual([{ t: 'key-asked' }])
    // No key is taken before it is revealed.
    expect(env.db.prepare('select public_key from devices where id = ?').get(fresh.id)).toEqual(
      before,
    )
  })

  test('answered, the asking computer reveals to the computer that answered, and only it', async () => {
    const { laptop, desktop, fresh } = await three()
    const key = await asks(fresh)
    laptop.socket.take()
    desktop.socket.take()
    fresh.socket.take()

    await send(hubOf(laptop), laptop.socket, {
      t: 'answer-key',
      to: fresh.id,
      nonce: 'N'.repeat(44),
      pub: HOLDER,
    })
    expect(fresh.socket.take()).toEqual([
      { t: 'key-answered', from: laptop.id, nonce: 'N'.repeat(44), pub: HOLDER },
    ])
    // The first answer stands.
    await send(hubOf(desktop), desktop.socket, {
      t: 'answer-key',
      to: fresh.id,
      nonce: 'M'.repeat(44),
      pub: HOLDER,
    })
    expect(fresh.socket.take()).toEqual([])

    await send(hubOf(fresh), fresh.socket, { t: 'reveal-key', pub: key.pub, nonce: key.nonce })
    expect(laptop.socket.take()).toEqual([
      { t: 'key-revealed', device: fresh.id, pub: key.pub, nonce: key.nonce },
    ])
    expect(desktop.socket.take()).toEqual([])
    expect(env.db.prepare('select public_key from devices where id = ?').get(fresh.id)).toEqual({
      public_key: key.pub,
    })
  })

  test('takes no reveal other than what was committed to, and no answer from a computer without the key', async () => {
    const { laptop, fresh } = await three()
    const other = await computer(env, running, EMAIL, 'Tablet', false)
    const key = await asks(fresh)
    fresh.socket.take()

    await send(hubOf(other), other.socket, {
      t: 'answer-key',
      to: fresh.id,
      nonce: 'N'.repeat(44),
      pub: HOLDER,
    })
    expect(other.socket.take()).toEqual([
      { t: 'refused', to: 'answer-key', error: 'only a computer with the key answers' },
    ])
    expect(fresh.socket.take()).toEqual([])

    await send(hubOf(laptop), laptop.socket, {
      t: 'answer-key',
      to: fresh.id,
      nonce: 'N'.repeat(44),
      pub: HOLDER,
    })
    laptop.socket.take()
    fresh.socket.take()
    const swapped = await aKey()
    await send(hubOf(fresh), fresh.socket, { t: 'reveal-key', pub: swapped.pub, nonce: key.nonce })
    expect(fresh.socket.take()).toEqual([
      { t: 'refused', to: 'reveal-key', error: 'not what this computer committed to' },
    ])
    expect(laptop.socket.take()).toEqual([])

    // Nor is an Allow of a computer that never revealed.
    await send(hubOf(laptop), laptop.socket, {
      t: 'grant-key',
      to: fresh.id,
      wrapped: WRAPPED,
      generation: 1,
    })
    expect(fresh.socket.take()).toEqual([])
    expect(
      env.db.prepare('select count(*) as many from web_keys where device_id = ?').get(fresh.id),
    ).toEqual({ many: 0 })
  })

  test('asked again with the same commitment once answered, the answer comes back', async () => {
    const { laptop, fresh } = await three()
    const key = await asks(fresh)
    await send(hubOf(laptop), laptop.socket, {
      t: 'answer-key',
      to: fresh.id,
      nonce: 'N'.repeat(44),
      pub: HOLDER,
    })
    fresh.socket.take()
    laptop.socket.take()

    await send(hubOf(fresh), fresh.socket, { t: 'want-key', commitment: key.commitment })
    expect(fresh.socket.take()).toEqual([
      { t: 'key-asked' },
      { t: 'key-answered', from: laptop.id, nonce: 'N'.repeat(44), pub: HOLDER },
    ])
    expect(laptop.socket.take()).toEqual([])
  })

  test('the computer that answered hears the reveal again when it connects again', async () => {
    const laptop = await computer(env, running, EMAIL, 'Laptop')
    const fresh = await computer(env, running, EMAIL, 'Studio', false)
    const key = await asksAndReveals(fresh, laptop)
    await hangUp(hubOf(laptop), running.of(laptop.user).state, laptop.socket)

    const back = connect(hubOf(laptop), {
      device: laptop.id,
      who: laptop.user,
      session: laptop.session,
    })
    await send(hubOf(laptop), back, {
      t: 'hello',
      device: laptop.id,
      name: 'Laptop',
      platform: 'windows',
      app: '1',
    })
    expect(back.take()).toEqual([
      { t: 'key', wrapped: 'w'.repeat(60), generation: 1 },
      { t: 'key-revealed', device: fresh.id, pub: key.pub, nonce: key.nonce },
    ])
  })

  test('a computer from before the commitment is told to update, and is not relayed', async () => {
    const { laptop, fresh } = await three()
    await send(hubOf(fresh), fresh.socket, { t: 'want-key', pub: PUB })
    expect(fresh.socket.take()).toEqual([
      { t: 'refused', to: 'want-key-old', error: 'update Orden on this computer to pair it' },
    ])
    expect(laptop.socket.take()).toEqual([
      { t: 'key-wanted-old', device: fresh.id, name: 'Studio' },
    ])
    await send(hubOf(laptop), laptop.socket, {
      t: 'grant-key',
      to: fresh.id,
      wrapped: WRAPPED,
      generation: 1,
    })
    expect(fresh.socket.take()).toEqual([])
  })

  test('given reaches the new computer, closes the other prompts, and tells the address', async () => {
    const { laptop, desktop, fresh } = await three()
    await asksAndReveals(fresh, laptop)
    laptop.socket.take()
    desktop.socket.take()
    fresh.socket.take()

    const sent = await mail(() =>
      send(hubOf(laptop), laptop.socket, {
        t: 'grant-key',
        to: fresh.id,
        wrapped: WRAPPED,
        generation: 1,
      }),
    )

    expect(fresh.socket.take()).toEqual([{ t: 'key', wrapped: WRAPPED, generation: 1 }])
    expect(desktop.socket.take()).toEqual([{ t: 'key-settled', device: fresh.id }])
    expect(
      env.db.prepare('select wrapped, generation from web_keys where device_id = ?').get(fresh.id),
    ).toEqual({ wrapped: WRAPPED, generation: 1 })
    expect(sent).toContain(`${EMAIL} - Studio was given your web logins`)
    expect(sent).toContain('If that was not you, end it in Settings, Account.')

    // And it can take a lease now.
    await send(hubOf(fresh), fresh.socket, { t: 'acquire', key: KEY, take: false })
    expect(fresh.socket.take()).toEqual([{ t: 'granted', key: KEY, fence: 1, version: 0 }])
  })

  test('given twice at once is given once', async () => {
    const { laptop, desktop, fresh } = await three()
    await asksAndReveals(fresh, laptop)
    fresh.socket.take()
    const grant = { t: 'grant-key', to: fresh.id, wrapped: WRAPPED, generation: 1 }

    const sent = await mail(async () => {
      await send(hubOf(laptop), laptop.socket, grant)
      await send(hubOf(desktop), desktop.socket, grant)
    })

    expect(fresh.socket.take()).toEqual([{ t: 'key', wrapped: WRAPPED, generation: 1 }])
    expect(sent.match(/was given your web logins/g)?.length).toBe(1)
    expect(desktop.socket.take().filter((one) => one.t === 'refused')).toEqual([])
  })

  test('refused tells the new computer, and closes the other prompts', async () => {
    const { laptop, desktop, fresh } = await three()
    await asksAndReveals(fresh, laptop)
    laptop.socket.take()
    desktop.socket.take()
    fresh.socket.take()

    await send(hubOf(laptop), laptop.socket, { t: 'deny-key', to: fresh.id })

    expect(fresh.socket.take()).toEqual([{ t: 'key-denied' }])
    expect(desktop.socket.take()).toEqual([{ t: 'key-settled', device: fresh.id }])
    expect(
      env.db.prepare('select count(*) as many from web_keys where device_id = ?').get(fresh.id),
    ).toEqual({ many: 0 })

    // Refused is refused: an approval after it has nothing to approve.
    await send(hubOf(desktop), desktop.socket, {
      t: 'grant-key',
      to: fresh.id,
      wrapped: WRAPPED,
      generation: 1,
    })
    expect(fresh.socket.take()).toEqual([])
    expect(desktop.socket.take()).toEqual([
      { t: 'refused', to: 'grant-key', error: 'that computer is no longer waiting' },
    ])
  })

  test('asked for while nobody could answer reaches the first one to connect', async () => {
    const laptop = await computer(env, running, EMAIL, 'Laptop')
    const fresh = await computer(env, running, EMAIL, 'Studio', false)
    await hangUp(hubOf(laptop), running.of(laptop.user).state, laptop.socket)

    const key = await asks(fresh)

    const back = connect(hubOf(laptop), {
      device: laptop.id,
      who: laptop.user,
      session: laptop.session,
    })
    await send(hubOf(laptop), back, {
      t: 'hello',
      device: laptop.id,
      name: 'Laptop',
      platform: 'windows',
      app: '1',
    })
    expect(back.take()).toEqual([
      { t: 'key', wrapped: 'w'.repeat(60), generation: 1 },
      { t: 'key-wanted', device: fresh.id, name: 'Studio', commitment: key.commitment },
    ])
  })

  test('asked for lapses fifteen minutes after the asking computer left', async () => {
    const laptop = await computer(env, running, EMAIL, 'Laptop')
    const fresh = await computer(env, running, EMAIL, 'Studio', false)
    const { state } = running.of(laptop.user)
    await asks(fresh)
    await hangUp(hubOf(fresh), state, fresh.socket)
    await hangUp(hubOf(laptop), state, laptop.socket)

    vi.setSystemTime(Date.now() + 16 * 60 * 1000)
    const back = connect(hubOf(laptop), {
      device: laptop.id,
      who: laptop.user,
      session: laptop.session,
    })
    await send(hubOf(laptop), back, {
      t: 'hello',
      device: laptop.id,
      name: 'Laptop',
      platform: 'windows',
      app: '1',
    })
    expect(back.take().map((one) => one.t)).toEqual(['key'])
  })

  test('asked for again is the same request, and a sixth new one in an hour is refused', async () => {
    const { laptop, fresh } = await three()
    const key = await aKey()
    for (let asked = 0; asked < 10; asked++) {
      await send(hubOf(fresh), fresh.socket, { t: 'want-key', commitment: key.commitment })
    }
    expect(laptop.socket.take()).toHaveLength(10)
    expect(fresh.socket.take()).toEqual(Array.from({ length: 10 }, () => ({ t: 'key-asked' })))

    // Four more, each with a fresh commitment, is five requests in all.
    for (let asked = 0; asked < 4; asked++) {
      await send(hubOf(fresh), fresh.socket, {
        t: 'want-key',
        commitment: (await aKey()).commitment,
      })
    }
    expect(fresh.socket.take().filter((one) => one.t === 'refused')).toEqual([])

    await send(hubOf(fresh), fresh.socket, { t: 'want-key', commitment: (await aKey()).commitment })
    expect(fresh.socket.take()).toEqual([
      {
        t: 'refused',
        to: 'want-key',
        error: 'too many tries - try again in an hour',
      },
    ])
  })

  test('is made by the first computer, and a fresh one lets go of what the old one sealed', async () => {
    const first = await computer(env, running, EMAIL, 'Laptop', false)
    const user = first.user

    // What an account whose every computer has been ended still holds.
    env.db
      .prepare(
        `insert into web_states (user_id, key, fence, version, generation, size, device_id, at)
         values (?, ?, 3, 9, 4, 1, 'gone', 1)`,
      )
      .run(user, KEY)
    await env.NOTES.put(`web/${user}/${KEY}`, new Uint8Array([1]))

    await send(hubOf(first), first.socket, {
      t: 'grant-key',
      to: first.id,
      wrapped: WRAPPED,
      generation: 5,
    })

    expect(first.socket.take()).toEqual([{ t: 'key', wrapped: WRAPPED, generation: 5 }])
    expect(env.db.prepare('select count(*) as many from web_states').get()).toEqual({ many: 0 })
    expect(env.keys().filter((one) => one.startsWith('web/'))).toEqual([])
  })

  test('is not made by a computer while another holds it', async () => {
    const { fresh } = await three()
    await send(hubOf(fresh), fresh.socket, {
      t: 'grant-key',
      to: fresh.id,
      wrapped: WRAPPED,
      generation: 1,
    })

    expect(fresh.socket.take()).toEqual([
      { t: 'refused', to: 'grant-key', error: 'that key is out of date' },
    ])
    expect(
      env.db.prepare('select count(*) as many from web_keys where device_id = ?').get(fresh.id),
    ).toEqual({ many: 0 })
  })

  test('moves to a new generation after a device is ended, one grant each', async () => {
    const { laptop, desktop } = await three()
    await call(env, `/v2/devices/${desktop.id}`, { method: 'DELETE', token: laptop.token })

    await send(hubOf(laptop), laptop.socket, {
      t: 'grant-key',
      to: laptop.id,
      wrapped: WRAPPED,
      generation: 2,
    })
    expect(laptop.socket.take()).toEqual([{ t: 'key', wrapped: WRAPPED, generation: 2 }])
    expect(
      env.db.prepare('select device_id, generation from web_keys order by device_id').all(),
    ).toEqual([{ device_id: laptop.id, generation: 2 }])
  })

  test('is sent on every hello, and a new public key takes the old wrapping with it', async () => {
    const laptop = await computer(env, running, EMAIL, 'Laptop')
    const hello = { t: 'hello', device: laptop.id, name: 'Laptop', platform: 'windows', app: '1' }

    await send(hubOf(laptop), laptop.socket, { ...hello, pub: PUB })
    expect(laptop.socket.take()).toEqual([{ t: 'key', wrapped: 'w'.repeat(60), generation: 1 }])

    await send(hubOf(laptop), laptop.socket, { ...hello, pub: 'N'.repeat(44) })
    expect(laptop.socket.take()).toEqual([])
    expect(env.db.prepare('select count(*) as many from web_keys').get()).toEqual({ many: 0 })
  })

  test('given still reaches the computer when the mail cannot go', async () => {
    const { laptop, fresh } = await three()
    env.EMAIL = {
      send: () => Promise.reject(new Error('the provider is down')),
    }
    env.MAIL_FROM = 'Nib <nib@nibeditor.com>'
    await asksAndReveals(fresh, laptop)
    fresh.socket.take()

    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await send(hubOf(laptop), laptop.socket, {
      t: 'grant-key',
      to: fresh.id,
      wrapped: WRAPPED,
      generation: 1,
    })
    quiet.mockRestore()

    expect(fresh.socket.take()).toEqual([{ t: 'key', wrapped: WRAPPED, generation: 1 }])
  })
})

describe('what a grant is', () => {
  const grant = {
    toSelf: false,
    holders: 2,
    mine: true,
    current: 3,
    held: null,
    wanted: true,
    generation: 3,
  }

  test('is an approval of a computer that asked, under the current generation', () => {
    expect(grantKind(grant)).toBe('approved')
    expect(grantKind({ ...grant, wanted: false })).toBeNull()
    expect(grantKind({ ...grant, generation: 2 })).toBeNull()
  })

  test('is a rotation under the next one, or the rest of one under the current', () => {
    expect(grantKind({ ...grant, generation: 4 })).toBe('rotated')
    expect(grantKind({ ...grant, held: 2, wanted: false })).toBe('rotated')
  })

  test('is nothing new for a computer that already has it', () => {
    expect(grantKind({ ...grant, held: 3 })).toBe('again')
  })

  test('is only ever from a computer that holds it, unless nobody does', () => {
    expect(grantKind({ ...grant, mine: false })).toBeNull()
    expect(grantKind({ ...grant, holders: 0, mine: false, current: null, toSelf: true })).toBe(
      'made',
    )
    expect(grantKind({ ...grant, holders: 0, mine: false, current: null })).toBeNull()
  })
})
