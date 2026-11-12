import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { momentOf } from '@orden/markdown/task-reminders'
import { inboxStamp } from '@orden/sync-core'
import { base64url, fromBase64url } from '../src/sync-server/src/push/keys'
import {
  MOST_TRIES,
  remindersIn,
  sendDue,
  TRY_AGAIN_AFTER,
} from '../src/sync-server/src/push/reminders'
import { writeInboxText } from '../src/sync-server/src/inbox-text'
import { forgetAccess } from '../src/sync-server/src/push/fcm'
import { encrypted } from '../src/sync-server/src/push/webpush'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let space: string

const ZONE = 'Europe/Zurich'
const WALL = { date: '2099-01-05', time: '09:00' }
const AT = momentOf(WALL, ZONE)
const TASK = '- [ ] Call the bank [remind:: 2099-01-05 09:00]\n'

beforeEach(async () => {
  env = testEnv()
  forgetAccess()
  token = await signIn(env, 'a@b.dev')
  const created = await call(env, '/v1/spaces', { token, body: { name: 'Work' } })
  space = (created.json as { space: { id: string } }).space.id
})

afterEach(() => env.close())

function recorded(...replies: ((url: string) => Response)[]) {
  const asked: { url: string; init: RequestInit | undefined }[] = []
  const send = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString()
    asked.push({ url, init })
    const reply = replies.shift()
    return Promise.resolve(reply ? reply(url) : new Response('no reply recorded', { status: 500 }))
  }) as typeof fetch
  return { send, asked }
}

function register(body: Record<string, string>) {
  return call<{ id: string; error?: string }>(env, '/v2/push/targets', { token, body })
}

async function inbox(content: string) {
  const user = (
    env.db.prepare('select user_id from spaces where id = ?').get(space) as { user_id: string }
  ).user_id
  await writeInboxText(env, user, content, new Date().toISOString().slice(0, 10))
}

function kept() {
  return env.db.prepare('select id, at, title, body, sent_at from push_reminders').all() as {
    id: string
    at: number
    title: string
    body: string
    sent_at: number | null
  }[]
}

describe('Web Push encryption', () => {
  test('is RFC 8291 to the byte, on its own worked example', async () => {
    const asPublic = fromBase64url(
      'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    )
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'EC',
        crv: 'P-256',
        x: base64url(asPublic.slice(1, 33)),
        y: base64url(asPublic.slice(33, 65)),
        d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
      },
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    )
    const body = await encrypted(
      fromBase64url('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'),
      {
        p256dh:
          'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
      { publicRaw: asPublic, privateKey, salt: fromBase64url('DGv6ra1nlYgDCS1FRnbzlw') },
    )
    expect(base64url(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    )
  })
})

describe('targets', () => {
  test('a device registers once per token, and takes itself off', async () => {
    const first = await register({ kind: 'fcm', token: 'phone-token', zone: ZONE })
    expect(first.status).toBe(200)
    const again = await register({ kind: 'fcm', token: 'phone-token', zone: 'Asia/Tokyo' })
    expect(again.json.id).toBe(first.json.id)
    expect(env.db.prepare('select zone from push_targets').all()).toEqual([{ zone: 'Asia/Tokyo' }])

    await call(env, `/v2/push/targets/${first.json.id}`, { method: 'DELETE', token })
    expect(env.db.prepare('select id from push_targets').all()).toEqual([])
  })

  test('refuses what is not a target', async () => {
    expect((await register({ kind: 'pigeon', token: 'x' })).status).toBe(400)
    expect(
      (await register({ kind: 'webpush', token: 'http://evil.test/x', p256dh: 'a', auth: 'b' }))
        .status,
    ).toBe(400)
    expect((await register({ kind: 'webpush', token: 'https://push.test/x' })).status).toBe(400)
    expect((await register({ kind: 'fcm', token: 't', zone: 'Mars/Olympus' })).status).toBe(400)
  })

  test('says which services are on', async () => {
    expect((await call(env, '/v2/push/key', { token })).json).toEqual({
      webpush: null,
      fcm: false,
      apns: false,
    })
    env.VAPID_PUBLIC_KEY = 'BPublic'
    env.VAPID_PRIVATE_KEY = 'private'
    expect((await call(env, '/v2/push/key', { token })).json).toMatchObject({ webpush: 'BPublic' })
  })

  test('is closed to anybody signed out', async () => {
    expect(
      (await call(env, '/v2/push/targets', { body: { kind: 'fcm', token: 't' } })).status,
    ).toBe(401)
  })
})

describe('reminders kept from the inbox', () => {
  test('only for an account with somewhere to push to', async () => {
    await inbox(TASK)
    expect(kept()).toEqual([])

    await register({ kind: 'fcm', token: 'phone-token', zone: ZONE })
    await inbox('')
    await inbox(TASK)
    expect(kept()).toMatchObject([{ at: AT, title: 'Call the bank', sent_at: null }])
  })

  test('never from a checkbox in a note that is no to-do list (#1229)', async () => {
    await register({ kind: 'fcm', token: 'phone-token', zone: ZONE })
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'Meeting.md', content: TASK },
    })
    expect(kept()).toEqual([])
  })

  test('a ticked task takes its reminder away', async () => {
    await register({ kind: 'fcm', token: 'phone-token', zone: ZONE })
    await inbox(TASK)
    expect(kept()).toHaveLength(1)
    await inbox('- [x] Call the bank [remind:: 2099-01-05 09:00] ✅ 2099-01-04\n')
    expect(kept()).toEqual([])
  })

  test('read the way the app reads them: no code, no front matter, the same id', () => {
    const content = ['---', 'title: Plan', '---', '```', TASK.trim(), '```', TASK.trim()].join('\n')
    const found = remindersIn(content, 'Work', 'Plan.md', ZONE, null, 0)
    expect(found.map((one) => [one.line, one.at])).toEqual([[6, AT]])
    expect(found[0]?.id).toMatch(/^[0-9a-f]{16}$/)
  })

  test('a counted and a written reminder a clock change sets apart are two rows', () => {
    const content = '- [ ] a [time:: 02:00] [remind:: 30m, 1:30] 🛫 2026-11-01\n'
    const found = remindersIn(content, 'Work', 'Plan.md', 'America/New_York', null, 0)
    expect(found.map((one) => one.at)).toEqual([
      Date.UTC(2026, 10, 1, 5, 30),
      Date.UTC(2026, 10, 1, 6, 30),
    ])
    expect(new Set(found.map((one) => one.id)).size).toBe(2)
  })
})

describe('sending', () => {
  async function serviceAccount() {
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
    return JSON.stringify({ client_email: 'nib@x.iam', private_key: pem, project_id: 'orden-test' })
  }

  function soon() {
    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
    return {
      task: `- [ ] Call the bank [remind:: ${day} 09:00]\n`,
      at: momentOf({ date: day, time: '09:00' }, ZONE),
    }
  }

  test('a reminder whose minute has gone by is still sent after the note is saved (#458)', async () => {
    env.FCM_SERVICE_ACCOUNT = await serviceAccount()
    await register({ kind: 'fcm', token: 'phone-token', zone: ZONE })
    const { task, at } = soon()
    await inbox(task)
    expect(kept()).toHaveLength(1)

    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(at + 2000)
      await inbox(`${task}- [ ] And another\n`)
      expect(kept()).toMatchObject([{ at, sent_at: null }])

      const fcm = recorded(
        () => Response.json({ access_token: 'access', expires_in: 3600 }),
        () => Response.json({ name: 'projects/orden-test/messages/1' }),
      )
      expect(await sendDue(env, at + 5000, fcm.send)).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  test('but one written for a time already gone, or ticked once due, is not', async () => {
    await register({ kind: 'fcm', token: 'phone-token', zone: ZONE })
    const { task, at } = soon()

    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(at + 2000)
      await inbox(task)
      expect(kept()).toEqual([])

      vi.setSystemTime(at - 60_000)
      await inbox('')
      await inbox(task)
      expect(kept()).toHaveLength(1)
      vi.setSystemTime(at + 2000)
      await inbox(task.replace('[ ]', '[x]'))
      expect(kept()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  test('a due reminder goes to a phone once, as data the app decides on', async () => {
    env.FCM_SERVICE_ACCOUNT = await serviceAccount()
    await register({ kind: 'fcm', token: 'phone-token', zone: ZONE })
    await inbox(TASK)

    const fcm = recorded(
      () => Response.json({ access_token: 'access', expires_in: 3600 }),
      () => Response.json({ name: 'projects/orden-test/messages/1' }),
    )
    expect(await sendDue(env, AT - 60_000, fcm.send)).toBe(0)
    expect(await sendDue(env, AT, fcm.send)).toBe(1)
    expect(fcm.asked.map((one) => one.url)).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://fcm.googleapis.com/v1/projects/orden-test/messages:send',
    ])
    const sent = JSON.parse(fcm.asked[1]?.init?.body as string) as {
      message: { token: string; data: Record<string, string> }
    }
    expect(sent.message.token).toBe('phone-token')
    expect(sent.message.data).toMatchObject({
      kind: 'reminder',
      title: 'Call the bank',
      path: '.orden-inbox.md',
    })
    expect(sent.message.data.id).toBe(kept()[0]?.id)

    expect(await sendDue(env, AT + 60_000, fcm.send)).toBe(0)
    await inbox(`${TASK}- [ ] Another\n`)
    expect(kept().filter((one) => one.sent_at !== null)).toHaveLength(1)
  })

  test('a reminder of a to-do in the account inbox is kept and sent, with no note behind it (#1576)', async () => {
    env.FCM_SERVICE_ACCOUNT = await serviceAccount()
    await register({ kind: 'fcm', token: 'phone-token', zone: ZONE })
    const stamp = inboxStamp(1, 0, 'one')
    await call(env, '/v2/inbox', {
      token,
      body: {
        changes: [
          {
            id: 'a',
            fields: { text: 'Call the bank', status: ' ', remind: '2099-01-05 09:00', order: 0 },
            stamps: { text: stamp, status: stamp, remind: stamp, order: stamp },
          },
        ],
      },
    })
    expect(kept().map((one) => [one.at, one.title])).toEqual([[AT, 'Call the bank']])

    const fcm = recorded(
      () => Response.json({ access_token: 'access', expires_in: 3600 }),
      () => Response.json({ name: 'projects/orden-test/messages/1' }),
    )
    expect(await sendDue(env, AT, fcm.send)).toBe(1)
    const sent = JSON.parse(fcm.asked[1]?.init?.body as string) as {
      message: { data: Record<string, string> }
    }
    expect(sent.message.data).toMatchObject({ title: 'Call the bank', path: '.orden-inbox.md' })

    const later = inboxStamp(2, 0, 'one')
    await call(env, '/v2/inbox', {
      token,
      body: { changes: [{ id: 'a', fields: { gone: true }, stamps: { gone: later } }] },
    })
    expect(kept()).toEqual([])
  })

  test('a subscription its service no longer has is dropped', async () => {
    const vapid = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
    ])) as CryptoKeyPair
    const jwk = (await crypto.subtle.exportKey('jwk', vapid.privateKey)) as JsonWebKey
    env.VAPID_PUBLIC_KEY = base64url(
      new Uint8Array((await crypto.subtle.exportKey('raw', vapid.publicKey)) as ArrayBuffer),
    )
    env.VAPID_PRIVATE_KEY = jwk.d ?? ''

    const browser = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair
    const p256dh = base64url(
      new Uint8Array((await crypto.subtle.exportKey('raw', browser.publicKey)) as ArrayBuffer),
    )
    await register({
      kind: 'webpush',
      token: 'https://push.example/send/abc',
      p256dh,
      auth: base64url(crypto.getRandomValues(new Uint8Array(16))),
      zone: ZONE,
    })
    await inbox(TASK)

    const gone = recorded(() => new Response('', { status: 410 }))
    await sendDue(env, AT, gone.send)
    const asked = gone.asked[0]
    expect(asked?.url).toBe('https://push.example/send/abc')
    const headers = asked?.init?.headers as Record<string, string>
    expect(headers.authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/)
    expect(headers['content-encoding']).toBe('aes128gcm')
    expect(env.db.prepare('select id from push_targets').all()).toEqual([])
  })

  test('a service with no keys is left alone, and its target kept', async () => {
    await register({ kind: 'apns', token: 'iphone-token', zone: ZONE })
    await inbox(TASK)
    const none = recorded()
    expect(await sendDue(env, AT, none.send)).toBe(0)
    expect(none.asked).toEqual([])
    expect(env.db.prepare('select kind from push_targets').all()).toEqual([{ kind: 'apns' }])
  })

  describe('a push no service took', () => {
    const OK = () => Response.json({ name: 'projects/orden-test/messages/1' })
    const DOWN = () => new Response('down', { status: 503 })
    const TOKEN = () => Response.json({ access_token: 'access', expires_in: 3600 })
    const MINUTE = 60_000

    function service(reply: () => Response) {
      const ids: string[] = []
      const send = ((input: string, init?: RequestInit) => {
        if (input.includes('oauth2')) return Promise.resolve(TOKEN())
        const body = JSON.parse(init?.body as string) as { message: { data: { id: string } } }
        ids.push(body.message.data.id)
        return Promise.resolve(reply())
      }) as typeof fetch
      return { ids, send }
    }

    async function due() {
      env.FCM_SERVICE_ACCOUNT = await serviceAccount()
      await register({ kind: 'fcm', token: 'phone-token', zone: ZONE })
      await inbox(TASK)
    }

    test('is tried again after a wait, and rings once', async () => {
      await due()

      const down = service(DOWN)
      expect(await sendDue(env, AT, down.send)).toBe(0)
      expect(kept()).toMatchObject([{ sent_at: null }])

      expect(await sendDue(env, AT + MINUTE, down.send)).toBe(0)
      expect(down.ids).toHaveLength(1)

      const back = service(OK)
      expect(await sendDue(env, AT + TRY_AGAIN_AFTER, back.send)).toBe(1)
      expect(back.ids).toHaveLength(1)
      expect(await sendDue(env, AT + TRY_AGAIN_AFTER + MINUTE, back.send)).toBe(0)
      expect(back.ids).toHaveLength(1)
    })

    test.each([
      ['too many requests', 429, true],
      ['unavailable', 503, true],
      ['an error it may have taken the message before', 500, false],
      ['a gateway that may have got it there', 502, false],
      ['a refusal of the sender', 403, false],
    ])('is tried again only where it did not take it: %s', async (_, status, again) => {
      await due()
      const first = service(() => new Response('no', { status }))
      await sendDue(env, AT, first.send)
      const later = service(OK)
      expect(await sendDue(env, AT + TRY_AGAIN_AFTER, later.send)).toBe(again ? 1 : 0)
    })

    test('and where the service could not be reached', async () => {
      await due()
      const unreachable = ((input: string) =>
        input.includes('oauth2')
          ? Promise.resolve(TOKEN())
          : Promise.reject(new Error('connection reset'))) as typeof fetch
      await sendDue(env, AT, unreachable)
      expect(await sendDue(env, AT + TRY_AGAIN_AFTER, service(OK).send)).toBe(1)
    })

    test('is not tried again where another device of the account took it', async () => {
      await due()
      await register({ kind: 'fcm', token: 'other-phone', zone: ZONE })
      await inbox(TASK)

      const replies = [OK, DOWN]
      const half = service(() => (replies.shift() ?? OK)())
      expect(await sendDue(env, AT, half.send)).toBe(1)
      expect(half.ids).toHaveLength(2)

      const after = service(OK)
      expect(await sendDue(env, AT + TRY_AGAIN_AFTER, after.send)).toBe(0)
      expect(after.ids).toEqual([])
    })

    test('nor where a device beside it may have taken it', async () => {
      await due()
      await register({ kind: 'fcm', token: 'other-phone', zone: ZONE })
      await inbox(TASK)

      const replies = [() => new Response('no', { status: 500 }), DOWN]
      await sendDue(env, AT, service(() => (replies.shift() ?? OK)()).send)
      expect(await sendDue(env, AT + TRY_AGAIN_AFTER, service(OK).send)).toBe(0)
    })

    test('stops being tried once it is too late to be worth ringing', async () => {
      await due()
      const down = service(DOWN)
      for (let minute = 0; minute <= 180; minute++) {
        await sendDue(env, AT + minute * MINUTE, down.send)
      }
      expect(down.ids).toHaveLength(MOST_TRIES)
      expect(kept()[0]?.sent_at).not.toBeNull()
    })

    test('is not tried again where a service has no keys', async () => {
      await register({ kind: 'apns', token: 'iphone-token', zone: ZONE })
      await inbox(TASK)
      expect(await sendDue(env, AT, recorded().send)).toBe(0)
      expect(kept()[0]?.sent_at).toBe(AT)
    })

    test('keeps its wait through a save of the inbox', async () => {
      await due()
      const down = service(DOWN)
      await sendDue(env, AT, down.send)

      await inbox(`${TASK}- [ ] And a line\n`)
      await sendDue(env, AT + MINUTE, down.send)
      expect(down.ids).toHaveLength(1)
    })

    test('holds up no reminder due, and the tries of a whole minute stay bounded', async () => {
      await due()
      const row = env.db.prepare('select note_id, user_id, space_id from push_reminders').get() as {
        note_id: string
        user_id: string
        space_id: string
      }
      env.db.prepare('delete from push_reminders').run()
      const insert = env.db.prepare(
        `insert into push_reminders
           (note_id, id, user_id, space_id, at, title, body, path, hash, line, sent_at)
         values (?, ?, ?, ?, ?, 'Due', 'Plan', 'Plan.md', 'h', 0, null)`,
      )
      for (let one = 0; one < 250; one++) {
        insert.run(row.note_id, `due-${one}`, row.user_id, row.space_id, AT)
      }

      const down = service(DOWN)
      await sendDue(env, AT, down.send)
      expect(down.ids).toHaveLength(200)
      await sendDue(env, AT + MINUTE, down.send)
      expect(new Set(down.ids).size).toBe(250)
      expect(down.ids).toHaveLength(250)

      for (let minute = 2; minute <= 180; minute++) {
        await sendDue(env, AT + minute * MINUTE, down.send)
      }
      expect(down.ids).toHaveLength(250 * MOST_TRIES)
    })
  })
})

test('the automatic reminder is an account setting, of the choices the app offers', async () => {
  const set = await call(env, '/v1/settings', {
    method: 'PATCH',
    token,
    body: { remindBefore: 15 },
  })
  expect(set.status).toBe(200)
  const wrong = await call(env, '/v1/settings', {
    method: 'PATCH',
    token,
    body: { remindBefore: 7 },
  })
  expect(wrong.status).toBe(400)
})
