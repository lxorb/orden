import { chatListOf } from '@orden/chats/wire'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MOST_BLOCKED, mailReports, sweepReports } from '../src/sync-server-chats/src/chats/safety'
import { eraseAccount } from '../src/sync-server-engine/src/erase'
import { forgetAccess } from '../src/sync-server/src/push/fcm'
import { chatLogs, fire } from './chat-fakes'
import { call, mail, type ShareView, signIn, type TestEnv, testEnv } from './harness'
import { hubs } from './hub-fakes'

const T0 = Date.UTC(2026, 10, 27, 12)
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
describe('blocking and reporting in chats', () => {
  let env: TestEnv
  let logs: ReturnType<typeof chatLogs>
  let running: ReturnType<typeof hubs>
  let pushed: string[]
  let owner: string
  let writer: string
  let reader: string
  let ids: { owner: string; writer: string; reader: string }
  let space: string
  let chat: string
  let clock = T0
  const tick = (ms: number) => vi.setSystemTime((clock += ms))
  const userId = async (token: string): Promise<string> => (await call(env, '/v1/me', { token })).json.user.id
  const who = (key: keyof typeof ids) => `user:${ids[key]}`
  async function says(token: string, event: unknown) {
    const answer = await call(env, `/v2/chats/${chat}/events`, { token, body: { events: [event] } })
    expect(answer.status).toBe(200)
    await logs.of(chat).state.idle()
  }
  async function flushed() {
    tick(2000)
    await fire(logs.of(chat))
  }
  async function listedFor(token: string) {
    await flushed()
    const read = chatListOf((await call(env, '/v2/chats', { token })).json)
    return read?.chats.find((one) => one.id === chat)
  }
  const block = (token: string, blocked: string) =>
    call(env, `/v2/chats/blocks/${encodeURIComponent(blocked)}`, { method: 'PUT', token })
  const unblock = (token: string, blocked: string) =>
    call(env, `/v2/chats/blocks/${encodeURIComponent(blocked)}`, { method: 'DELETE', token })
  const blockedBy = async (token: string): Promise<string[]> =>
    (await call<{ blocked: string[] }>(env, '/v2/chats/blocks', { token })).json.blocked
  const pokedOf = (key: keyof typeof ids) =>
    running.asked
      .filter((one) => one.id === ids[key] && one.ask === 'chat')
      .map((one) => one.headers.get('x-orden-mention'))
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    clock = T0
    tick(0)
    env = testEnv()
    forgetAccess()
    logs = chatLogs(env)
    env.CHATS = logs.CHATS
    running = hubs(env)
    env.HUB = running.HUB
    env.FCM_SERVICE_ACCOUNT = await serviceAccount()
    pushed = []
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.includes('oauth2')) return Promise.resolve(Response.json({ access_token: 'access', expires_in: 3600 }))
      pushed.push((JSON.parse(init?.body as string) as { message: { token: string } }).message.token)
      return Promise.resolve(Response.json({ name: 'projects/orden-test/messages/1' }))
    })
    owner = await signIn(env, 'owner@example.com')
    space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Thesis' } })).json.space.id
    for (const email of ['writer@example.com', 'reader@example.com']) {
      await call(env, `/v1/spaces/${space}/share/invite`, { token: owner, body: { email, role: 'write' } })
    }
    tick(31_000)
    writer = await signIn(env, 'writer@example.com')
    tick(31_000)
    reader = await signIn(env, 'reader@example.com')
    tick(31_000)
    ids = { owner: await userId(owner), writer: await userId(writer), reader: await userId(reader) }
    chat = (await call<{ chat: string }>(env, '/v2/chats', { token: owner, body: { space } })).json.chat
    for (const [token, name] of [
      [owner, 'owner-chat'],
      [writer, 'writer-chat'],
      [reader, 'reader-chat'],
    ] as const) {
      await call(env, '/v2/push/targets', { token, body: { kind: 'fcm', token: name, app: 'chat' } })
    }
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    env.close()
  })
  describe('a block', () => {
    test('is kept for the account, read back on every device, and taken off again', async () => {
      expect((await block(writer, who('owner'))).status).toBe(200)
      expect((await block(writer, who('owner'))).status).toBe(200)
      const second = await signIn(env, 'writer@example.com')
      expect(await blockedBy(second)).toEqual([who('owner')])
      expect(await blockedBy(owner)).toEqual([])
      expect((await unblock(writer, who('owner'))).status).toBe(200)
      expect(await blockedBy(second)).toEqual([])
    })
    test('refuses oneself, a program and what names nobody', async () => {
      for (const one of [who('writer'), 'program:agent', 'somebody', 'here']) {
        expect((await block(writer, one)).status, one).toBe(400)
      }
      expect(await blockedBy(writer)).toEqual([])
    })
    test('is not for a guest, who has no account to keep it', async () => {
      const { json } = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
        method: 'PUT',
        token: owner,
        body: { role: 'write', mode: 'open' },
      })
      const link = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')?.[1] ?? ''
      const guest: string = (await call(env, `/v1/join/${link}`, { method: 'POST', body: { name: 'Guest' } })).json
        .token
      expect((await block(guest, who('owner'))).status).toBe(403)
      expect(env.db.prepare('select count(*) as many from chat_blocks').get()).toEqual({ many: 0 })
    })
    test('stops at its limit, however the requests arrive', async () => {
      const add = env.db.prepare('insert into chat_blocks (user_id, blocked, created_at) values (?, ?, 1)')
      for (let at = 0; at < MOST_BLOCKED - 1; at++) add.run(ids.writer, `user:filler-${String(at)}`)
      const answers = await Promise.all([block(writer, who('owner')), block(writer, who('reader'))])
      expect(answers.map((one) => one.status).sort()).toEqual([200, 409])
      expect(await blockedBy(writer)).toHaveLength(MOST_BLOCKED)
    })
    test('goes with the account of either side when it is deleted', async () => {
      await block(writer, who('owner'))
      await block(reader, who('writer'))
      await eraseAccount(env, { id: ids.writer, email: 'writer@example.com', name: null, created_at: 1 })
      expect(env.db.prepare('select user_id, blocked from chat_blocks').all()).toEqual([])
    })
  })
  describe('from somebody blocked', () => {
    beforeEach(async () => {
      await block(writer, who('owner'))
    })
    test('a mention is not pushed, not counted and not poked as one, while everybody else still gets theirs', async () => {
      await says(owner, post('Both of you', { mentions: [who('writer'), who('reader')] }))
      expect(pushed).toEqual(['reader-chat'])
      expect(pokedOf('writer')).toEqual([])
      expect(pokedOf('reader')).toEqual(['yes'])
      expect((await listedFor(writer))?.mentions).toBe(0)
      expect((await listedFor(reader))?.mentions).toBe(1)
    })
    test('a mention of everyone leaves the blocker out too', async () => {
      await says(owner, post('All hands', { mentions: ['everyone'] }))
      expect(pushed).toEqual(['reader-chat'])
      expect((await listedFor(writer))?.mentions).toBe(0)
    })
    test('a reply to the blocker’s message is not pushed and not counted', async () => {
      const first = post('Draft is up')
      await says(writer, first)
      pushed.length = 0
      await says(owner, post('Reading it', { parent: first.message }))
      expect(pushed).toEqual([])
      expect((await listedFor(writer))?.mentions).toBe(0)
      await says(reader, post('Me too', { parent: first.message }))
      expect(pushed).toEqual(['writer-chat'])
      expect((await listedFor(writer))?.mentions).toBe(1)
    })
    test('a message that names nobody pokes the others and not the blocker', async () => {
      await says(owner, post('Morning'))
      expect(pokedOf('writer')).toEqual([])
      expect(pokedOf('reader')).toEqual(['no'])
    })
    test('the other way round nothing changes: the blocked person still hears the blocker', async () => {
      await says(writer, post('Owner?', { mentions: [who('owner')] }))
      expect(pushed).toEqual(['owner-chat'])
      expect((await listedFor(owner))?.mentions).toBe(1)
    })
    test('once the block is taken off, the next mention arrives again', async () => {
      await unblock(writer, who('owner'))
      tick(61_000)
      await says(owner, post('Wren?', { mentions: [who('writer')] }))
      expect(pushed).toEqual(['writer-chat'])
      expect((await listedFor(writer))?.mentions).toBe(1)
    })
  })
  describe('a report', () => {
    const report = (token: string, body: unknown, where = chat) =>
      call<{ id: string; error?: string }>(env, `/v2/chats/${where}/reports`, { token, body })
    const rows = () =>
      env.db
        .prepare('select reporter, chat_id, space_id, message_id, reported, reason, body, mailed_at from chat_reports')
        .all() as Record<string, unknown>[]
    test('of a message keeps who wrote it and what it said, and is mailed with the account id and no address', async () => {
      env.CHAT_REPORTS_TO = 'reports@example.com'
      const bad = post('Something unkind')
      await says(owner, bad)
      let answer: Awaited<ReturnType<typeof report>> | undefined
      const sent = await mail(async () => {
        answer = await report(writer, { message: bad.message, reason: 'Harassment' })
      })
      expect(answer?.status).toBe(201)
      expect(rows()).toEqual([
        {
          reporter: ids.writer,
          chat_id: chat,
          space_id: space,
          message_id: bad.message,
          reported: who('owner'),
          reason: 'Harassment',
          body: 'Something unkind',
          mailed_at: Date.now(),
        },
      ])
      expect(sent).toContain('[mail] reports@example.com - A chat report on Orden')
      expect(sent).toContain(`Reporter: account ${ids.writer}`)
      expect(sent).toContain('Message text: Something unkind')
      expect(sent).not.toContain('writer@example.com')
      expect(sent).not.toContain('owner@example.com')
    })
    test('of a person needs no message', async () => {
      expect((await report(writer, { who: who('owner'), reason: 'Spam' })).status).toBe(201)
      expect(rows().map((one) => [one.message_id, one.reported, one.body])).toEqual([[null, who('owner'), '']])
    })
    test('with nowhere to mail it is kept and not mailed', async () => {
      const sent = await mail(async () => {
        expect((await report(writer, { who: who('owner'), reason: 'Spam' })).status).toBe(201)
      })
      expect(sent).not.toContain('[mail]')
      expect(rows().map((one) => one.mailed_at)).toEqual([null])
    })
    test('made right after another waits for the next mail, which carries both', async () => {
      env.CHAT_REPORTS_TO = 'reports@example.com'
      const first = await mail(() => report(writer, { who: who('owner'), reason: 'One' }))
      const second = await mail(() => report(reader, { who: who('owner'), reason: 'Two' }))
      expect(first).toContain('Reason: One')
      expect(second).not.toContain('[mail]')
      expect(rows().map((one) => one.mailed_at === null)).toEqual([false, true])
      tick(31_000)
      const later = await mail(() => mailReports(env))
      expect(later).toContain('Reason: Two')
      expect(later).not.toContain('Reason: One')
      expect(rows().every((one) => one.mailed_at !== null)).toBe(true)
    })
    test('is refused for a chat the reporter does not reach, as if there were none', async () => {
      const stranger = await signIn(env, 'stranger@example.com')
      const answer = await report(stranger, { who: who('owner'), reason: 'Spam' })
      expect([answer.status, answer.json.error]).toEqual([404, 'no such chat'])
      expect((await report(writer, { who: who('owner') }, 'c_00000000000000000000000000000000')).status).toBe(404)
      expect(rows()).toEqual([])
    })
    test('is refused for a message the chat does not hold, somebody not in it, oneself, or nothing named', async () => {
      const stranger = await signIn(env, 'stranger@example.com')
      const mine = post('Mine')
      await says(writer, mine)
      expect((await report(writer, { message: 'msg-none', reason: '' })).status).toBe(404)
      expect((await report(writer, { who: `user:${await userId(stranger)}` })).status).toBe(404)
      expect((await report(writer, { who: who('writer') })).status).toBe(400)
      expect((await report(writer, { message: mine.message })).status).toBe(400)
      expect((await report(writer, { reason: 'Nobody' })).status).toBe(400)
      expect((await report(writer, { who: who('owner'), reason: 'x'.repeat(1001) })).status).toBe(400)
      expect(rows()).toEqual([])
    })
    test('keeps at most a thousand characters of the message', async () => {
      const long = post('y'.repeat(3000))
      await says(owner, long)
      await report(writer, { message: long.message })
      expect(rows().map((one) => (one.body as string).length)).toEqual([1000])
    })
    test('stops after twenty in an hour from one account', async () => {
      const answers = []
      for (let at = 0; at < 21; at++) answers.push((await report(writer, { who: who('owner') })).status)
      expect(answers.filter((one) => one === 201)).toHaveLength(20)
      expect(answers.at(-1)).toBe(429)
    })
    test('outlives the account of either side: it no longer says who made it, and still says whom it was about', async () => {
      await report(writer, { who: who('owner'), reason: 'Made by the one leaving' })
      await report(reader, { who: who('writer'), reason: 'About the one leaving' })
      await eraseAccount(env, { id: ids.writer, email: 'writer@example.com', name: null, created_at: 1 })
      expect(rows().map((one) => [one.reporter, one.reported, one.reason])).toEqual([
        ['', who('owner'), 'Made by the one leaving'],
        [ids.reader, who('writer'), 'About the one leaving'],
      ])
      env.CHAT_REPORTS_TO = 'reports@example.com'
      const sent = await mail(() => mailReports(env))
      expect(sent).toContain('Reporter: an account since deleted')
      expect(sent).not.toContain('writer@example.com')
    })
    test('is dropped a year after it was made, mailed or not', async () => {
      await report(writer, { who: who('owner'), reason: 'Never mailed' })
      const year = 365 * 24 * 60 * 60 * 1000
      const made = Date.now()
      tick(60_000)
      env.CHAT_REPORTS_TO = 'reports@example.com'
      await mail(() => report(reader, { who: who('owner'), reason: 'Mailed later' }))
      env.db.exec("update chat_reports set mailed_at = null where reason = 'Never mailed'")
      expect(await sweepReports(env, made + year - 1)).toBe(0)
      expect(await sweepReports(env, made + year + 1)).toBe(1)
      expect(rows().map((one) => one.reason)).toEqual(['Mailed later'])
      expect(await sweepReports(env, made + year + 60_001)).toBe(1)
      expect(rows()).toEqual([])
    })
  })
})
