import { chatPushOf } from '@orden/chats/push'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reachAs } from '../src/sync-server-chats/src/chats/reach'
import { forgetAccess } from '../src/sync-server/src/push/fcm'
import { sendDue } from '../src/sync-server/src/push/reminders'
import { chatLogs, hangUp, open } from './chat-fakes'
import { call, type ShareView, signIn, type TestEnv, testEnv } from './harness'
import { hubs } from './hub-fakes'

const T0 = Date.UTC(2026, 10, 27, 12)
let step = 0
const later = () => vi.setSystemTime(T0 + ++step * 31_000)
let counter = 0
const id = (prefix = 'ev') => `${prefix}${String(++counter).padStart(8, '0')}`
const post = (body: string, extra: Record<string, unknown> = {}) => ({
  kind: 'post',
  id: id(),
  message: id('msg'),
  body,
  ...extra,
})
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
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer)
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`
  return JSON.stringify({ client_email: 'orden@x.iam', private_key: pem, project_id: 'orden-test' })
}
interface Pushed {
  token: string
  data: Record<string, string>
}
describe('a chat push', () => {
  let env: TestEnv
  let logs: ReturnType<typeof chatLogs>
  let pushed: Pushed[]
  let owner: string
  let writer: string
  let reader: string
  let ids: { owner: string; writer: string; reader: string }
  let space: string
  let chat: string
  const userId = async (token: string): Promise<string> => (await call(env, '/v1/me', { token })).json.user.id
  async function register(token: string, name: string, app?: string) {
    const answer = await call<{ id: string }>(env, '/v2/push/targets', {
      token,
      body: { kind: 'fcm', token: name, ...(app ? { app } : {}) },
    })
    expect(answer.status).toBe(200)
    return answer.json.id
  }
  async function says(token: string, event: unknown, where = chat) {
    const answer = await call(env, `/v2/chats/${where}/events`, { token, body: { events: [event] } })
    expect(answer.status).toBe(200)
    await logs.of(where).state.idle()
    return pushed.splice(0, pushed.length)
  }
  async function shared(name: string, ...emails: string[]) {
    const made: string = (await call(env, '/v1/spaces', { token: owner, body: { name } })).json.space.id
    for (const email of emails) {
      await call(env, `/v1/spaces/${made}/share/invite`, { token: owner, body: { email, role: 'write' } })
    }
    return made
  }
  const chatIn = async (where: string): Promise<string> =>
    (await call<{ chat: string }>(env, '/v2/chats', { token: owner, body: { space: where } })).json.chat
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    step = 0
    later()
    env = testEnv()
    forgetAccess()
    logs = chatLogs(env)
    env.CHATS = logs.CHATS
    env.HUB = hubs(env).HUB
    env.FCM_SERVICE_ACCOUNT = await serviceAccount()
    pushed = []
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.includes('oauth2')) return Promise.resolve(Response.json({ access_token: 'access', expires_in: 3600 }))
      const body = JSON.parse(init?.body as string) as { message: Pushed }
      pushed.push({ token: body.message.token, data: body.message.data })
      return Promise.resolve(Response.json({ name: 'projects/orden-test/messages/1' }))
    })
    owner = await signIn(env, 'owner@example.com')
    space = await shared('Thesis', 'writer@example.com', 'reader@example.com')
    later()
    writer = await signIn(env, 'writer@example.com')
    later()
    reader = await signIn(env, 'reader@example.com')
    later()
    ids = { owner: await userId(owner), writer: await userId(writer), reader: await userId(reader) }
    chat = await chatIn(space)
    await register(writer, 'writer-chat', 'chat')
    await register(writer, 'writer-orden')
    await register(reader, 'reader-chat', 'chat')
    await register(owner, 'owner-chat', 'chat')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    env.close()
  })
  describe('for a mention', () => {
    test('goes to the Chat app of the person named and to nothing else', async () => {
      const event = post('Lunch, Wren?', { mentions: [`user:${ids.writer}`] })
      const got = await says(owner, event)
      expect(got.map((one) => one.token)).toEqual(['writer-chat'])
      const read = chatPushOf(got[0]?.data)
      expect(read).toMatchObject({
        chat,
        space,
        message: event.message,
        id: event.message,
        from: `user:${ids.owner}`,
        reason: 'mention',
        body: 'Lunch, Wren?',
        text: 'yes',
      })
    })
    test('of everyone goes to every other member', async () => {
      const got = await says(owner, post('All hands', { mentions: ['everyone'] }))
      expect(got.map((one) => one.token).sort()).toEqual(['reader-chat', 'writer-chat'])
    })
    test('never goes to its own author', async () => {
      expect(await says(owner, post('Note to self', { mentions: [`user:${ids.owner}`] }))).toEqual([])
    })
    test('does not go to somebody who has the chat open', async () => {
      const person = { id: ids.writer, guest: false }
      const reached = await reachAs(env, person, chat)
      const socket = await open(
        logs.of(chat),
        { ...person, who: `user:${ids.writer}`, role: reached?.role ?? 'read', device: 'device-writer' },
        { chat, space },
      )
      const event = () => post('Here?', { mentions: [`user:${ids.writer}`] })
      expect(await says(owner, event())).toEqual([])
      await hangUp(logs.of(chat), socket)
      expect((await says(owner, event())).map((one) => one.token)).toEqual(['writer-chat'])
    })
    test('says so when the message has no text', async () => {
      const got = await says(
        owner,
        post('', {
          mentions: [`user:${ids.writer}`],
          poll: { question: 'When?', answers: ['Mon', 'Tue'], several: false },
        }),
      )
      expect(got.map((one) => [one.data.text, one.data.body])).toEqual([['no', '']])
    })
  })
  describe('for a reply', () => {
    test('goes to the author of the message answered', async () => {
      const first = post('Draft is up')
      expect(await says(writer, first)).toEqual([])
      const got = await says(owner, post('Reading it now', { parent: first.message }))
      expect(got.map((one) => [one.token, one.data.reason])).toEqual([['writer-chat', 'reply']])
    })
  })
  describe('for a message that names nobody', () => {
    test('is not sent in a chat of more than two', async () => {
      expect(await says(owner, post('Morning'))).toEqual([])
    })
    test('is sent to the other of two, as a direct message', async () => {
      const pair = await shared('Pair', 'writer@example.com')
      const direct = await chatIn(pair)
      const got = await says(owner, post('Just us'), direct)
      expect(got.map((one) => [one.token, one.data.reason])).toEqual([['writer-chat', 'direct']])
    })
    test('is sent to somebody who asked for every message of the chat', async () => {
      await call(env, `/v2/chats/${chat}/me`, { method: 'PUT', token: reader, body: { notify: 'all' } })
      const got = await says(owner, post('Morning'))
      expect(got.map((one) => [one.token, one.data.reason])).toEqual([['reader-chat', 'all']])
    })
  })
  describe('to somebody who hushed the chat', () => {
    const mention = () => post('Wren?', { mentions: [`user:${ids.writer}`] })
    test('is not sent while it is muted, and is again once the mute has run out', async () => {
      const until = Date.now() + 3_600_000
      await call(env, `/v2/chats/${chat}/me`, { method: 'PUT', token: writer, body: { mutedUntil: until } })
      expect(await says(owner, mention())).toEqual([])
      vi.setSystemTime(until + 1)
      expect((await says(owner, mention())).map((one) => one.token)).toEqual(['writer-chat'])
    })
    test('is not sent when they asked for nothing from it', async () => {
      await call(env, `/v2/chats/${chat}/me`, { method: 'PUT', token: writer, body: { notify: 'nothing' } })
      expect(await says(owner, mention())).toEqual([])
    })
    test('a direct message is not sent when they asked for mentions only', async () => {
      const pair = await shared('Pair', 'writer@example.com')
      const direct = await chatIn(pair)
      await call(env, `/v2/chats/${direct}/me`, { method: 'PUT', token: writer, body: { notify: 'mentions' } })
      expect(await says(owner, post('Just us'), direct)).toEqual([])
      expect((await says(owner, mention(), direct)).map((one) => one.data.reason)).toEqual(['mention'])
    })
  })
  describe('and the targets of the account', () => {
    const mention = () => post('Wren?', { mentions: [`user:${ids.writer}`] })
    test('a target registered before targets named their app is the full Orden, and gets no chat push', async () => {
      env.db.exec("delete from push_targets where token = 'writer-chat'")
      expect(
        env.db.prepare("select app from push_targets where token = 'writer-orden'").get() as { app: string },
      ).toEqual({ app: 'orden' })
      expect(await says(owner, mention())).toEqual([])
    })
    test('a token that rotates replaces the old one once the phone takes the old one off', async () => {
      const old = await register(writer, 'writer-chat', 'chat')
      await call(env, `/v2/push/targets/${old}`, { method: 'DELETE', token: writer })
      await register(writer, 'writer-chat-2', 'chat')
      expect((await says(owner, mention())).map((one) => one.token)).toEqual(['writer-chat-2'])
    })
    test('a token registered again under another app moves to it', async () => {
      await register(writer, 'writer-orden', 'chat')
      expect((await says(owner, mention())).map((one) => one.token).sort()).toEqual(['writer-chat', 'writer-orden'])
    })
    test('signing out takes the target off', async () => {
      await call(env, '/v1/auth/signout', { method: 'POST', token: writer })
      expect(await says(owner, mention())).toEqual([])
    })
    test('an app the server does not know is refused', async () => {
      const answer = await call(env, '/v2/push/targets', {
        token: writer,
        body: { kind: 'fcm', token: 't', app: 'pass' },
      })
      expect(answer.status).toBe(400)
    })
    test('a guest has no target: the table takes none', async () => {
      const { json } = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
        method: 'PUT',
        token: owner,
        body: { role: 'write', mode: 'open' },
      })
      const link = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')?.[1] ?? ''
      const walked = await call(env, `/v1/join/${link}`, { method: 'POST', body: { name: 'Guest' } })
      const guest: string = walked.json.guest.id
      const add = env.db.prepare(
        `insert into push_targets (id, user_id, kind, token, created_at, app)
         values ('g1', ?, 'fcm', 'guest-chat', 1, 'chat')`,
      )
      expect(() => add.run(guest)).toThrow(/FOREIGN KEY/)
      const got = await says(owner, post('Hello', { mentions: [`guest:${guest}`, 'everyone'] }))
      expect(got.map((one) => one.token).sort()).toEqual(['reader-chat', 'writer-chat'])
    })
    test('with no push service configured nothing is asked of anybody', async () => {
      delete env.FCM_SERVICE_ACCOUNT
      expect(await says(owner, mention())).toEqual([])
      expect(env.db.prepare('select count(*) as many from push_targets where failed_at is not null').get()).toEqual({
        many: 0,
      })
    })
  })
  describe('beside a reminder', () => {
    test('a reminder goes to the full Orden and never to the Chat app', async () => {
      env.db
        .prepare(
          `insert into push_reminders
             (note_id, id, user_id, space_id, at, title, body, path, hash, line, sent_at, tries, retry_at)
           values (?, 'r1', ?, ?, ?, 'Call the bank', '', 'todo', 'h', 0, null, 0, null)`,
        )
        .run(`inbox:${ids.writer}`, ids.writer, space, Date.now())
      const own = (await call(env, '/v1/spaces', { token: writer })).json.spaces as { id: string }[]
      env.db.prepare('update push_reminders set space_id = ?').run(own[0]?.id ?? space)
      expect(await sendDue(env, Date.now())).toBe(1)
      expect(pushed.map((one) => [one.token, one.data.kind])).toEqual([['writer-orden', 'reminder']])
    })
  })
})
