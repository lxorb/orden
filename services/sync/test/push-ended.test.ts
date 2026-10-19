/** A device that is no longer signed in is pushed nothing (#454): ended from the
 *  devices list, its session ended, signed out, or run out. See src/push/live.ts. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { momentOf } from '@nib/markdown/task-reminders'
import { sha256 } from '../src/crypto'
import { forgetAccess } from '../src/push/fcm'
import { sendDue } from '../src/push/reminders'
import { call, type TestEnv, testEnv } from './harness'
import { computer, type Hubs, hubs } from './hub-fakes'

const EMAIL = 'phone@example.com'
const ZONE = 'Europe/Zurich'
const AT = momentOf({ date: '2099-01-05', time: '09:00' }, ZONE)
const TASK = '- [ ] Private task [remind:: 2099-01-05 09:00]\n'

let env: TestEnv
let running: Hubs

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.UTC(2026, 8, 30, 12))
  env = testEnv()
  forgetAccess()
  running = hubs(env)
  env.HUB = running.HUB
})

afterEach(() => {
  vi.useRealTimers()
  env.close()
})

/** A Google service account with a key of its own. */
async function serviceAccount(): Promise<string> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const der = new Uint8Array(
    (await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer,
  )
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`
  return JSON.stringify({ client_email: 'nib@x.iam', private_key: pem, project_id: 'nib-test' })
}

/** What FCM was asked to deliver, and to which tokens. */
function fcm() {
  const tokens: string[] = []
  const send = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (url.includes('oauth2')) {
      return Promise.resolve(Response.json({ access_token: 'access', expires_in: 3600 }))
    }
    const body = JSON.parse(init?.body as string) as { message: { token: string } }
    tokens.push(body.message.token)
    return Promise.resolve(Response.json({ name: 'projects/nib-test/messages/1' }))
  }) as typeof fetch
  return { send, tokens }
}

/** A phone and a laptop of one account, the phone registered to be pushed to, and a
 *  reminder due. */
async function setUp() {
  env.FCM_SERVICE_ACCOUNT = await serviceAccount()
  const phone = await computer(env, running, EMAIL, 'Phone')
  const laptop = await computer(env, running, EMAIL, 'Laptop')

  for (const [one, name] of [
    [phone, 'lost-phone-token'],
    [laptop, 'laptop-token'],
  ] as const) {
    const registered = await call(env, '/v2/push/targets', {
      token: one.token,
      body: { kind: 'fcm', token: name, zone: ZONE, device: one.id },
    })
    expect(registered.status).toBe(200)
  }

  const space = (await call(env, '/v1/spaces', { token: laptop.token, body: { name: 'Work' } }))
    .json.space.id
  await call(env, `/v1/spaces/${space}/notes`, {
    token: laptop.token,
    body: { path: 'Plan.md', content: TASK },
  })
  return { phone, laptop }
}

function targets(): string[] {
  return (
    env.db.prepare('select token from push_targets order by token').all() as { token: string }[]
  ).map((one) => one.token)
}

describe('a device no longer signed in', () => {
  test('is pushed to while it is', async () => {
    await setUp()
    const sent = fcm()
    expect(await sendDue(env, AT, sent.send)).toBe(1)
    expect(sent.tokens.sort()).toEqual(['laptop-token', 'lost-phone-token'])
  })

  test('is pushed nothing once it is ended from the devices list', async () => {
    const { phone, laptop } = await setUp()
    const ended = await call(env, `/v2/devices/${phone.id}`, {
      method: 'DELETE',
      token: laptop.token,
    })
    expect(ended.status).toBe(200)
    expect((await call(env, '/v1/me', { token: phone.token })).status).toBe(401)
    expect(targets()).toEqual(['laptop-token'])

    const sent = fcm()
    await sendDue(env, AT, sent.send)
    expect(sent.tokens).toEqual(['laptop-token'])
  })

  test('nor once its session is ended from the sessions list', async () => {
    const { phone, laptop } = await setUp()
    await call(env, `/v1/sessions/${phone.session}`, { method: 'DELETE', token: laptop.token })
    expect(targets()).toEqual(['laptop-token'])

    const sent = fcm()
    await sendDue(env, AT, sent.send)
    expect(sent.tokens).toEqual(['laptop-token'])
  })

  test('nor once every other session is ended', async () => {
    await setUp()
    const desk = await computer(env, running, EMAIL, 'Desk')
    await call(env, '/v1/sessions', { method: 'DELETE', token: desk.token })
    expect(targets()).toEqual([])
  })

  test('nor once it signs itself out', async () => {
    const { phone } = await setUp()
    await call(env, '/v1/auth/signout', { method: 'POST', token: phone.token })
    expect(targets()).toEqual(['laptop-token'])

    const sent = fcm()
    await sendDue(env, AT, sent.send)
    expect(sent.tokens).toEqual(['laptop-token'])
  })

  test('nor once its session has run out, whatever row is left', async () => {
    const { phone } = await setUp()
    env.db
      .prepare('update sessions set expires_at = 1 where token_hash = ?')
      .run(await sha256(phone.token))
    expect(targets()).toContain('lost-phone-token')

    const sent = fcm()
    await sendDue(env, AT, sent.send)
    expect(sent.tokens).toEqual(['laptop-token'])
  })

  test('nor a target registered before targets named their session', async () => {
    await setUp()
    env.db.exec("update push_targets set session_hash = null where token = 'lost-phone-token'")

    const sent = fcm()
    await sendDue(env, AT, sent.send)
    expect(sent.tokens).toEqual(['laptop-token'])
  })
})
