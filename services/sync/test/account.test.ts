import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { KEPT_FOR, sweepLeaving } from '../src/sync-server-accounts/src/account'
import { codeAt } from '../src/sync-server-accounts/src/second'
import { type Answer, call, file, joined, mail, signIn, type TestEnv, testEnv } from './harness'

interface LeavingView {
  resendIn?: number
  second?: boolean
  ticket?: string
  ok?: boolean
  gone?: boolean
  deleteAfter?: number
  deletionCancelled?: boolean
  error?: string
  holding?: string
  token?: string
  user?: { id: string; email: string }
  space?: { id: string }
  spaces?: { id: string; name: string }[]
  deleted?: string[]
  note?: { id: string; version?: number }
  notes?: { id: string; path: string }[]
  members?: { email: string | null }[]
}
const KEPT = { OPENAI_KEY_SECRET: 'a secret for the tests' }
const ME = 'leaving@example.com'
const OTHER = 'staying@example.com'
let env: TestEnv
let token: string
beforeEach(async () => {
  env = testEnv(KEPT)
  token = await signIn(env, ME)
})
afterEach(() => env.close())
async function askToLeave(as = token): Promise<{ answer: Answer<LeavingView>; code: string; mailed: string }> {
  const answers: Answer<LeavingView>[] = []
  const mailed = await mail(async () => {
    answers.push(await call<LeavingView>(env, '/v1/account/delete/code', { token: as, body: {} }))
  })
  const found = /(\d{3}) (\d{3})/.exec(mailed)
  const answer = answers[0]
  if (!answer) throw new Error('step one answered nothing')
  return { answer, code: found ? `${found[1]}${found[2]}` : '', mailed }
}
function verify(code: string, second?: string, as = token) {
  return call<LeavingView>(env, '/v1/account/delete/verify', {
    token: as,
    body: { code, ...(second === undefined ? {} : { second }) },
  })
}
function confirm(ticket: string | undefined, as = token) {
  return call<LeavingView>(env, '/v1/account', {
    method: 'DELETE',
    token: as,
    body: ticket === undefined ? {} : { ticket },
  })
}
async function ask(as = token): Promise<Answer<LeavingView>> {
  const { code } = await askToLeave(as)
  const { json } = await verify(code, undefined, as)
  return await confirm(json.ticket, as)
}
const A_DAY = 24 * 60 * 60 * 1000
async function leave(as = token): Promise<Answer<LeavingView>> {
  const answer = await ask(as)
  await sweepLeaving(env, Date.now() + KEPT_FOR + A_DAY)
  return answer
}
function held(email = ME): { delete_after: number | null; delete_warned_at: number | null } | undefined {
  return env.db.prepare('select delete_after, delete_warned_at from users where email = ?').get(email) as
    { delete_after: number | null; delete_warned_at: number | null } | undefined
}
async function signInSaying(email: string): Promise<LeavingView> {
  const logged = await mail(() => call(env, '/v1/auth/code', { body: { email } }))
  const code = /(\d{3}) (\d{3})/.exec(logged)
  return (await call<LeavingView>(env, '/v1/auth/verify', { body: { email, code: `${code?.[1]}${code?.[2]}` } })).json
}
function wrong(code: string): string {
  return code.replace(/^./, (digit) => String((Number(digit) + 1) % 10))
}
async function me(as = token) {
  return await call<LeavingView>(env, '/v1/me', { token: as })
}
async function enrol(): Promise<string> {
  const begun = await call<LeavingView>(env, '/v1/second', { token, body: {} })
  const row = env.db
    .prepare("select value from cached where scope = 'second-pending' order by until desc limit 1")
    .get() as { value: string }
  const secret = row.value.split(':')[1] ?? ''
  await call(env, '/v1/second/confirm', {
    token,
    body: { holding: begun.json.holding, code: await codeAt(secret, step()) },
  })
  return secret
}
function step(): number {
  return Math.floor(Date.now() / 30_000)
}
describe('the door', () => {
  test('a session alone deletes nothing', async () => {
    expect((await confirm(undefined)).status).toBe(400)
    expect((await confirm('f'.repeat(64))).status).toBe(400)
    expect((await me()).status).toBe(200)
  })
  test('mails a fresh code to the account’s own address, saying what it is for', async () => {
    const { answer, code, mailed } = await askToLeave()
    expect(answer.status).toBe(200)
    expect(answer.json.second).toBe(false)
    expect(code).toMatch(/^\d{6}$/)
    expect(mailed).toContain(ME)
    expect(mailed).toContain('delete your Orden account')
  })
  test('refuses a wrong code, and the account stays', async () => {
    const { code } = await askToLeave()
    const answer = await verify(wrong(code))
    expect(answer.status).toBe(400)
    expect(answer.json.ticket).toBeUndefined()
    expect((await me()).status).toBe(200)
  })
  test('refuses a code that has run out', async () => {
    const { code } = await askToLeave()
    env.db.exec('update login_codes set expires_at = 1')
    expect((await verify(code)).status).toBe(400)
  })
  test('takes a code once', async () => {
    const { code } = await askToLeave()
    expect((await verify(code)).status).toBe(200)
    expect((await verify(code)).status).toBe(400)
  })
  test('and deletes with the ticket the codes earned', async () => {
    const answer = await leave()
    expect(answer.status).toBe(200)
    expect(answer.json.ok).toBe(true)
    expect((await me()).status).toBe(401)
  })
  test('and says so to the address afterwards', async () => {
    await ask()
    const receipt = await mail(() => sweepLeaving(env, Date.now() + KEPT_FOR + A_DAY))
    expect(receipt).toContain(ME)
    expect(receipt).toContain('Your Orden account has been deleted')
    expect(env.db.prepare('select count(*) as many from limits where key = ?').get(ME)).toEqual({
      many: 0,
    })
  })
  test('afterwards the ticket alone can ask whether it went, so a lost answer is not guessed at', async () => {
    const { code } = await askToLeave()
    const { json } = await verify(code)
    const ticket = json.ticket ?? ''
    expect((await call<LeavingView>(env, '/v1/account/left', { body: { ticket } })).json).toEqual({
      gone: false,
    })
    expect((await confirm(ticket)).status).toBe(200)
    expect((await confirm(ticket)).status).toBe(401)
    const asked = await call<LeavingView>(env, '/v1/account/left', { body: { ticket } })
    expect(asked.status).toBe(200)
    expect(asked.json).toEqual({ gone: true, deleteAfter: held()?.delete_after })
    expect((await call<LeavingView>(env, '/v1/account/left', { body: { ticket: 'f'.repeat(64) } })).json).toEqual({
      gone: false,
    })
  })
  test('a session ended elsewhere deletes nothing, and the ticket says so', async () => {
    const { code } = await askToLeave()
    const { json } = await verify(code)
    await call(env, '/v1/auth/signout', { token, body: {} })
    expect((await confirm(json.ticket)).status).toBe(401)
    expect((await call<LeavingView>(env, '/v1/account/left', { body: { ticket: json.ticket } })).json).toEqual({
      gone: false,
    })
    expect(env.db.prepare('select count(*) as many from users where email = ?').get(ME)).toEqual({
      many: 1,
    })
  })
  test('a ticket runs out', async () => {
    const { code } = await askToLeave()
    const { json } = await verify(code)
    env.db.exec("update cached set until = 1 where scope = 'leaving'")
    expect((await confirm(json.ticket)).status).toBe(400)
    expect((await me()).status).toBe(200)
  })
  test('somebody else’s ticket deletes nobody', async () => {
    const other = await signIn(env, OTHER)
    const { code } = await askToLeave()
    const { json } = await verify(code)
    expect((await confirm(json.ticket, other)).status).toBe(400)
    expect((await me(other)).status).toBe(200)
    expect((await me()).status).toBe(200)
    expect((await confirm(json.ticket)).status).toBe(200)
    expect((await me(other)).status).toBe(200)
  })
  test('somebody else’s mailed code proves nothing about this account', async () => {
    const other = await signIn(env, OTHER)
    const theirs = await askToLeave(other)
    await askToLeave()
    expect((await verify(theirs.code)).status).toBe(400)
  })
  test('with a second factor, the mailed code is half of it', async () => {
    const secret = await enrol()
    const { answer, code } = await askToLeave()
    expect(answer.json.second).toBe(true)
    expect((await verify(code)).status).toBe(400)
    expect((await verify(code, '000000')).status).toBe(400)
    const right = await verify(code, await codeAt(secret, step()))
    expect(right.status).toBe(200)
    expect((await confirm(right.json.ticket)).status).toBe(200)
  })
  test('with a second factor, a stolen session and the mailbox are not enough', async () => {
    await enrol()
    const { code } = await askToLeave()
    for (const second of ['', '123456', 'aaaaa-bbbbb-ccccc-ddddd']) {
      expect((await verify(code, second)).status).toBe(400)
    }
    expect((await me()).status).toBe(200)
  })
  test('is shut to a guest and to a program', async () => {
    const minted = await call<LeavingView>(env, '/v1/mcp/token', {
      token,
      body: { readOnly: false },
    })
    const program = minted.json.token ?? ''
    const space = (await call<LeavingView>(env, '/v1/spaces', { token, body: { name: 'Open' } })).json.space?.id
    const linked = await call<{ link: { url: string } }>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token,
      body: { role: 'write', mode: 'open' },
    })
    const link = /\/join\/([a-f0-9]+)/.exec(linked.json.link.url)?.[1]
    const guest = (await call<LeavingView>(env, `/v1/join/${link}`, { method: 'POST', body: {} })).json.token
    for (const as of [program, guest ?? '']) {
      expect((await call(env, '/v1/account/delete/code', { token: as, body: {} })).status).toBe(403)
      expect((await verify('123456', undefined, as)).status).toBe(403)
      expect((await confirm('x', as)).status).toBe(403)
    }
  })
  test('counts every ask, and stops at ten an hour', async () => {
    for (let ask = 0; ask < 10; ask++) {
      expect((await call(env, '/v1/account/delete/code', { token, body: {} })).status).toBe(200)
    }
    const refused = await call<LeavingView>(env, '/v1/account/delete/code', { token, body: {} })
    expect(refused.status).toBe(429)
    expect((await verify('123456')).status).toBe(429)
  })
})
describe('thirty days to change its mind', () => {
  async function shared(): Promise<{ other: string; mine: string; note: string; guest: string }> {
    const other = await signIn(env, OTHER)
    const mine = (await call<LeavingView>(env, '/v1/spaces', { token, body: { name: 'Mine' } })).json.space?.id ?? ''
    const note =
      (await call<LeavingView>(env, `/v1/spaces/${mine}/notes`, { token, body: { path: 'shared.md', content: 'x' } }))
        .json.note?.id ?? ''
    await joined(env, token, mine, OTHER, 'read', { as: other })
    const made = await call<{ link?: { url: string } }>(env, `/v1/spaces/${mine}/share/link`, {
      method: 'PUT',
      token,
      body: { role: 'read', mode: 'open' },
    })
    const link = /\/join\/([a-f0-9]+)/.exec(made.json.link?.url ?? '')?.[1]
    const guest = await call<{ token: string }>(env, `/v1/join/${link}`, { method: 'POST', body: { name: 'Guest' } })
    return { other, mine, note, guest: guest.json.token }
  }
  test('the first step says how many days the account is kept, so an app only promises what this server does', async () => {
    const { answer } = await askToLeave()
    expect((answer.json as { keptDays?: number }).keptDays).toBe(30)
    expect(KEPT_FOR).toBe(30 * A_DAY)
  })
  test('asking sets the day thirty days on and deletes nothing', async () => {
    const before = Date.now()
    const space = (await call<LeavingView>(env, '/v1/spaces', { token, body: { name: 'Work' } })).json.space?.id
    await call(env, `/v1/spaces/${space}/notes`, { token, body: { path: 'plan.md', content: '# Plan\n' } })
    const rows = () =>
      ['users', 'spaces', 'notes', 'space_members', 'blobs', 'devices'].map(
        (table) => (env.db.prepare(`select count(*) as many from ${table}`).get() as { many: number }).many,
      )
    const was = rows()
    const objects = env.keys().length
    const answer = await ask()
    expect(answer.status).toBe(200)
    expect(answer.json.ok).toBe(true)
    expect(answer.json.deleteAfter).toBeGreaterThanOrEqual(before + KEPT_FOR)
    expect(answer.json.deleteAfter).toBeLessThanOrEqual(Date.now() + KEPT_FOR)
    expect(held()?.delete_after).toBe(answer.json.deleteAfter)
    expect(rows()).toEqual(was)
    expect(env.keys().length).toBe(objects)
    expect(env.db.prepare('select count(*) as many from leftovers').get()).toEqual({ many: 0 })
  })
  test('asking signs every device out', async () => {
    const elsewhere = await signIn(env, ME)
    expect((await me(elsewhere)).status).toBe(200)
    await ask()
    expect((await me()).status).toBe(401)
    expect((await me(elsewhere)).status).toBe(401)
    expect(env.db.prepare('select count(*) as many from sessions').get()).toEqual({ many: 0 })
  })
  test('asking ends every program’s way in too, and a program is no sign-in', async () => {
    const id = (await me()).json.user?.id ?? ''
    const program =
      (await call<LeavingView>(env, '/v1/mcp/token', { token, body: { readOnly: false } })).json.token ?? ''
    env.db
      .prepare(
        `insert into oauth_grants
           (id, user_id, client_id, client_name, read_only, access_hash, access_expires_at, refresh_hash, created_at)
         values ('g', ?, 'c', 'Client', 0, 'a', ?, 'r', 1)`,
      )
      .run(id, Date.now() + A_DAY)
    env.db
      .prepare(
        `insert into oauth_codes (code_hash, client_id, user_id, redirect_uri, challenge, read_only, expires_at)
         values ('h', 'c', ?, 'https://client.example/back', 'x', 0, ?)`,
      )
      .run(id, Date.now() + A_DAY)
    const other = await signIn(env, OTHER)
    const minted = await call<LeavingView>(env, '/v1/mcp/token', { token: other, body: { readOnly: false } })
    const theirs = minted.json.token ?? ''
    expect((await call(env, '/v1/spaces', { token: program })).status).toBe(200)
    await ask()
    expect((await call(env, '/v1/spaces', { token: program })).status).toBe(401)
    for (const table of ['mcp_tokens', 'oauth_grants', 'oauth_codes']) {
      expect(env.db.prepare(`select count(*) as many from ${table} where user_id = ?`).get(id), table).toEqual({
        many: 0,
      })
    }
    expect(held()?.delete_after).not.toBeNull()
    expect((await call(env, '/v1/spaces', { token: theirs })).status).toBe(200)
  })
  test('asking mails the day to the address', async () => {
    const { code } = await askToLeave()
    const { json } = await verify(code)
    const said = await mail(() => confirm(json.ticket))
    expect(said).toContain(ME)
    expect(said).toContain('will be deleted on')
    expect(said).toContain('signing in cancels the deletion')
    expect(said).not.toContain('has been deleted')
  })
  test('asking still answers when the mail may not be sent', async () => {
    const { code } = await askToLeave()
    const { json } = await verify(code)
    env.db
      .prepare("insert or replace into limits (scope, key, count, until) values ('mail-to', ?, 99, ?)")
      .run(ME, Date.now() + A_DAY)
    const said = await mail(async () => expect((await confirm(json.ticket)).status).toBe(200))
    expect(said).not.toContain('will be deleted on')
    expect(held()?.delete_after).toBeGreaterThan(Date.now())
  })
  test('the nights before the day delete nothing', async () => {
    const before = (await me()).json.user?.id
    const answer = await ask()
    const day = answer.json.deleteAfter ?? 0
    for (const at of [Date.now(), day - 29 * A_DAY, day - 4 * A_DAY, day - A_DAY, day - 1]) {
      await sweepLeaving(env, at)
    }
    expect(held()?.delete_after).toBe(day)
    expect(env.db.prepare('select count(*) as many from spaces').get()).toEqual({ many: 1 })
    const again = await signIn(env, ME)
    expect((await me(again)).json.user?.id).toBe(before)
  })
  test('signing in before the day cancels it, and says so once', async () => {
    const before = (await me()).json.user?.id
    await ask()
    const session = await signInSaying(ME)
    expect(session.deletionCancelled).toBe(true)
    expect(session.user?.id).toBe(before)
    expect(held()).toEqual({ delete_after: null, delete_warned_at: null })
    await sweepLeaving(env, Date.now() + KEPT_FOR + A_DAY)
    expect((await me(session.token)).status).toBe(200)
    expect((await signInSaying(ME)).deletionCancelled).toBeUndefined()
  })
  test('a sign-in that stops at the second factor cancels nothing until the factor is given', async () => {
    const secret = await enrol()
    const { code } = await askToLeave()
    const { json } = await verify(code, await codeAt(secret, step()))
    expect((await confirm(json.ticket)).status).toBe(200)
    const half = await signInSaying(ME)
    expect(half.token).toBeUndefined()
    expect(held()?.delete_after).not.toBeNull()
    env.db.exec('update users set totp_step = null')
    const whole = await call<LeavingView>(env, '/v1/auth/second', {
      body: { holding: half.holding, code: await codeAt(secret, step()) },
    })
    expect(whole.status).toBe(200)
    expect(whole.json.deletionCancelled).toBe(true)
    expect(held()?.delete_after).toBeNull()
  })
  test('a sign-in to another account cancels nothing', async () => {
    await ask()
    expect((await signInSaying(OTHER)).deletionCancelled).toBeUndefined()
    expect(held()?.delete_after).not.toBeNull()
  })
  test('an old ticket does not ask again after the sign-in', async () => {
    const { code } = await askToLeave()
    const { json } = await verify(code)
    expect((await confirm(json.ticket)).status).toBe(200)
    const again = await signIn(env, ME)
    expect((await confirm(json.ticket, again)).status).toBe(400)
    expect(held()?.delete_after).toBeNull()
  })
  test('the night after the day deletes it the way deleting always did, and says so', async () => {
    const answer = await ask()
    const day = answer.json.deleteAfter ?? 0
    const receipt = await mail(() => sweepLeaving(env, day))
    expect(receipt).toContain('Your Orden account has been deleted')
    expect(held()).toBeUndefined()
    expect(env.db.prepare('select count(*) as many from spaces').get()).toEqual({ many: 0 })
    expect(env.db.prepare('select count(*) as many from leftovers').get()).toEqual({ many: 0 })
  })
  test('a few days before the day one mail warns, once', async () => {
    const answer = await ask()
    const day = answer.json.deleteAfter ?? 0
    expect(await mail(() => sweepLeaving(env, day - 4 * A_DAY))).toBe('')
    const warned = await mail(() => sweepLeaving(env, day - 3 * A_DAY))
    expect(warned).toContain(ME)
    expect(warned).toContain('will be deleted on')
    expect(await mail(() => sweepLeaving(env, day - 2 * A_DAY))).toBe('')
    expect(held()?.delete_after).toBe(day)
  })
  test('the warning waits for a night the mail may be sent', async () => {
    const answer = await ask()
    const day = answer.json.deleteAfter ?? 0
    env.db.prepare("insert or replace into limits (scope, key, count, until) values ('mail-to', ?, 99, ?)").run(ME, day)
    expect(await mail(() => sweepLeaving(env, day - 3 * A_DAY))).toBe('')
    expect(held()?.delete_warned_at).toBeNull()
    env.db.exec("delete from limits where scope = 'mail-to'")
    expect(await mail(() => sweepLeaving(env, day - 2 * A_DAY))).toContain('will be deleted on')
  })
  test('asking again after a sign-in starts thirty new days and warns again', async () => {
    const first = await ask()
    const day = first.json.deleteAfter ?? 0
    await sweepLeaving(env, day - 2 * A_DAY)
    expect(held()?.delete_warned_at).not.toBeNull()
    token = await signIn(env, ME)
    env.db.exec('delete from limits')
    const second = await ask()
    expect(second.json.deleteAfter).toBeGreaterThanOrEqual(day)
    expect(held()?.delete_warned_at).toBeNull()
  })
  test('meanwhile a member and a guest of its shared space read on, and a share link still opens', async () => {
    const { other, mine, note, guest } = await shared()
    await ask()
    await sweepLeaving(env, Date.now() + KEPT_FOR - A_DAY)
    expect((await call(env, `/v1/notes/${note}`, { token: other })).status).toBe(200)
    expect((await call<LeavingView>(env, '/v1/spaces', { token: other })).json.spaces?.map((one) => one.id)).toContain(
      mine,
    )
    expect((await call<LeavingView>(env, '/v1/spaces', { token: guest })).json.spaces?.map((one) => one.id)).toEqual([
      mine,
    ])
    expect(env.db.prepare('select count(*) as many from space_links where space_id = ?').get(mine)).toEqual({ many: 1 })
  })
  test('and after the day the space is gone for the member and the guest', async () => {
    const { other, mine, note, guest } = await shared()
    await leave()
    expect((await call(env, `/v1/notes/${note}`, { token: other })).status).toBe(404)
    expect(
      (await call<LeavingView>(env, '/v1/spaces', { token: other })).json.spaces?.map((one) => one.id),
    ).not.toContain(mine)
    expect((await call<LeavingView>(env, '/v1/spaces', { token: guest })).json.spaces ?? []).toEqual([])
  })
  test('a space shared with it keeps it as a member until the day', async () => {
    const other = await signIn(env, OTHER)
    const theirs =
      (await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })).json.space?.id ?? ''
    await joined(env, other, theirs, ME, 'write', { as: token })
    await ask()
    const during = await call<LeavingView>(env, `/v1/spaces/${theirs}/share`, { token: other })
    expect(during.json.members?.map((one) => one.email)).toContain(ME)
    await sweepLeaving(env, Date.now() + KEPT_FOR + A_DAY)
    const after = await call<LeavingView>(env, `/v1/spaces/${theirs}/share`, { token: other })
    expect(after.json.members?.map((one) => one.email)).not.toContain(ME)
  })
  test('the nightly job is what deletes', async () => {
    const worker = (await import('../src/index')).default
    await ask()
    env.db.exec('update users set delete_after = 1 where delete_after is not null')
    const waiting: Promise<unknown>[] = []
    const context = {
      waitUntil: (work: Promise<unknown>) => waiting.push(work),
      passThroughOnException: () => undefined,
    }
    worker.scheduled({} as ScheduledEvent, env, context as unknown as ExecutionContext)
    await Promise.all(waiting)
    expect(held()).toBeUndefined()
  })
})
describe('what is left', () => {
  test('nothing of the account, and the address signs up as somebody new', async () => {
    const before = (await me()).json.user?.id
    const space = (await call<LeavingView>(env, '/v1/spaces', { token, body: { name: 'Work' } })).json.space?.id
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'plan.md', content: '# Plan\n' },
    })
    const held = (await call<LeavingView>(env, '/v1/spaces', { token })).json.spaces ?? []
    expect(held.map((one) => one.name)).toEqual(['Notes', 'Work'])
    expect(env.keys().some((key) => key.includes(space ?? '-'))).toBe(true)
    expect((await leave()).status).toBe(200)
    expect(env.db.prepare('select count(*) as many from leftovers').get()).toEqual({ many: 0 })
    expect(env.keys().filter((key) => held.some((one) => key.includes(one.id)))).toEqual([])
    const again = await signIn(env, ME)
    const fresh = await me(again)
    expect(fresh.json.user?.email).toBe(ME)
    expect(fresh.json.user?.id).not.toBe(before)
    const listed = await call<LeavingView>(env, '/v1/spaces', { token: again })
    expect(listed.json.spaces?.map((one) => one.name)).toEqual(['Notes'])
    expect(listed.json.deleted).toEqual([])
  })
  test('a space somebody shared with it stays theirs, with its notes, without it', async () => {
    const other = await signIn(env, OTHER)
    const theirs = (await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })).json.space
      ?.id
    await joined(env, other, theirs ?? '', ME, 'write', { as: token })
    const wrote = await call<LeavingView>(env, `/v1/spaces/${theirs}/notes`, {
      token,
      body: { path: 'mine in theirs.md', content: 'written by the one leaving' },
    })
    expect(wrote.status).toBe(201)
    expect((await leave()).status).toBe(200)
    const listed = await call<LeavingView>(env, '/v1/spaces', { token: other })
    expect(listed.json.spaces?.map((one) => one.id)).toContain(theirs)
    const changes = await call<LeavingView>(env, `/v1/spaces/${theirs}/changes?since=0`, {
      token: other,
    })
    expect(changes.json.notes?.map((one) => one.path)).toContain('mine in theirs.md')
    const shared = await call<LeavingView>(env, `/v1/spaces/${theirs}/share`, { token: other })
    expect(shared.json.members?.map((one) => one.email)).not.toContain(ME)
  })
  test('a guest that only said it was at its address keeps its way in, not the address', async () => {
    const other = await signIn(env, OTHER)
    const theirs = (await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })).json.space
      ?.id
    const made = await call<{ link?: { url: string } }>(env, `/v1/spaces/${theirs}/share/link`, {
      method: 'PUT',
      token: other,
      body: { role: 'write', mode: 'approval' },
    })
    const link = /\/join\/([a-f0-9]+)/.exec(made.json.link?.url ?? '')?.[1]
    const asked = await call<{ token: string }>(env, `/v1/join/${link}`, {
      method: 'POST',
      body: { email: ME },
    })
    const { id } = env.db.prepare('select id from guests where email = ?').get(ME) as { id: string }
    await call(env, `/v1/spaces/${theirs}/share/guests/${id}`, { method: 'POST', token: other })
    expect((await leave()).status).toBe(200)
    const listed = await call<LeavingView>(env, '/v1/spaces', { token: asked.json.token })
    expect(listed.json.spaces?.map((one) => one.id)).toEqual([theirs])
    expect(env.db.prepare('select email from guests where id = ?').get(id)).toEqual({ email: null })
  })
  test('its own space goes for everybody it was shared with', async () => {
    const other = await signIn(env, OTHER)
    const mine = (await call<LeavingView>(env, '/v1/spaces', { token, body: { name: 'Mine' } })).json.space?.id
    const note = (
      await call<LeavingView>(env, `/v1/spaces/${mine}/notes`, {
        token,
        body: { path: 'shared.md', content: 'x' },
      })
    ).json.note?.id
    await joined(env, token, mine ?? '', OTHER, 'read', { as: other })
    expect((await call(env, `/v1/notes/${note}`, { token: other })).status).toBe(200)
    expect((await leave()).status).toBe(200)
    expect((await call(env, `/v1/notes/${note}`, { token: other })).status).toBe(404)
    const listed = await call<LeavingView>(env, '/v1/spaces', { token: other })
    expect(listed.json.spaces?.map((one) => one.id)).not.toContain(mine)
  })
  test('a picture another account holds too stays; its own goes', async () => {
    const other = await signIn(env, OTHER)
    const shared = file(3, 1)
    const own = file(3, 2)
    const both = shared.hash
    const alone = own.hash
    for (const [picture, as] of [
      [shared, token],
      [shared, other],
      [own, token],
    ] as const) {
      await call(env, `/v1/blobs/${picture.hash}`, {
        method: 'PUT',
        token: as,
        raw: picture.bytes,
        headers: { 'content-type': 'image/png' },
      })
    }
    expect((await leave()).status).toBe(200)
    expect((await call(env, `/i/${both}.png`)).status).toBe(200)
    expect((await call(env, `/i/${alone}.png`)).status).toBe(404)
    expect(env.keys()).toContain(`blobs/${both}`)
    expect(env.keys()).not.toContain(`blobs/${alone}`)
  })
  test('a picture it put into a space that stays is handed to that space’s owner', async () => {
    const other = await signIn(env, OTHER)
    const theirs = (await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })).json.space
      ?.id
    await joined(env, other, theirs ?? '', ME, 'write', { as: token })
    const pictures = [file(3, 4), file(3, 5)]
    const [pasted, kept] = pictures.map((one) => one.hash) as [string, string]
    for (const picture of pictures) {
      await call(env, `/v1/blobs/${picture.hash}`, {
        method: 'PUT',
        token,
        raw: picture.bytes,
        headers: { 'content-type': 'image/png' },
      })
    }
    await call(env, `/v1/spaces/${theirs}/notes`, {
      token,
      body: { path: 'with a picture.md', content: `![](https://orden.so/i/${pasted}.png)` },
    })
    expect((await leave()).status).toBe(200)
    expect((await call(env, `/i/${pasted}.png`)).status).toBe(200)
    expect(env.db.prepare('select user_id from blobs where hash = ?').all(pasted)).toEqual([
      { user_id: (await me(other)).json.user?.id },
    ])
    expect((await call(env, `/i/${kept}.png`)).status).toBe(404)
  })
  test('a paper it hung on a page note in a space that stays is handed to that space’s owner', async () => {
    const other = await signIn(env, OTHER)
    const theirs = (await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })).json.space
      ?.id
    await joined(env, other, theirs ?? '', ME, 'write', { as: token })
    const pages = (
      await call<LeavingView>(env, `/v1/spaces/${theirs}/notes`, {
        token,
        body: { path: 'Lecture.pages', content: '{}' },
      })
    ).json.note?.id
    const bytes = new TextEncoder().encode('%PDF-1.4\na lecture\n%%EOF\n')
    const hash = createHash('sha256').update(bytes).digest('hex')
    await call(env, `/v1/blobs/${hash}`, {
      method: 'PUT',
      token,
      raw: bytes,
      headers: { 'content-type': 'application/pdf' },
    })
    await call(env, `/v1/notes/${pages}/paper`, { method: 'PUT', token, body: { hash } })
    expect((await leave()).status).toBe(200)
    expect((await call(env, `/v1/notes/${pages}/paper`, { token: other })).status).toBe(200)
    expect(env.db.prepare('select user_id from blobs where hash = ?').all(hash)).toEqual([
      { user_id: (await me(other)).json.user?.id },
    ])
  })
  test('a picture it put into a space it may now only read is handed over too', async () => {
    const other = await signIn(env, OTHER)
    const theirs = (await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })).json.space
      ?.id
    const sent = await mail(() =>
      call(env, `/v1/spaces/${theirs}/share/invite`, {
        token: other,
        body: { email: ME, role: 'write' },
      }),
    )
    await call(env, `/v1/join/${/\/join\/([a-f0-9]+)/.exec(sent)?.[1]}`, {
      method: 'POST',
      token,
    })
    const picture = file(3, 6)
    await call(env, `/v1/blobs/${picture.hash}`, {
      method: 'PUT',
      token,
      raw: picture.bytes,
      headers: { 'content-type': 'image/png' },
    })
    await call(env, `/v1/spaces/${theirs}/notes`, {
      token,
      body: {
        path: 'with a picture.md',
        content: `![](https://orden.so/i/${picture.hash}.png)`,
      },
    })
    const demoted = await call(env, `/v1/spaces/${theirs}/share/members/${encodeURIComponent(ME)}`, {
      method: 'PATCH',
      token: other,
      body: { role: 'read' },
    })
    expect(demoted.status).toBe(200)
    expect((await leave()).status).toBe(200)
    expect((await call(env, `/i/${picture.hash}.png`)).status).toBe(200)
    expect(env.db.prepare('select user_id from blobs where hash = ?').all(picture.hash)).toEqual([
      { user_id: (await me(other)).json.user?.id },
    ])
  })
  test.each([
    ['been taken out of', 'members'],
    ['left', 'me'],
  ])('a picture it put into a space it has since %s is handed over too', async (_, how) => {
    const other = await signIn(env, OTHER)
    const theirs = (await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })).json.space
      ?.id
    await joined(env, other, theirs ?? '', ME, 'write', { as: token })
    const picture = file(3, 10)
    await call(env, `/v1/blobs/${picture.hash}`, {
      method: 'PUT',
      token,
      raw: picture.bytes,
      headers: { 'content-type': 'image/png' },
    })
    await call(env, `/v1/spaces/${theirs}/notes`, {
      token,
      body: {
        path: 'with a picture.md',
        content: `![](https://orden.so/i/${picture.hash}.png)`,
      },
    })
    const out =
      how === 'me'
        ? await call(env, `/v1/spaces/${theirs}/share/me`, { method: 'DELETE', token })
        : await call(env, `/v1/spaces/${theirs}/share/members/${encodeURIComponent(ME)}`, {
            method: 'DELETE',
            token: other,
          })
    expect(out.status).toBe(200)
    expect((await leave()).status).toBe(200)
    expect((await call(env, `/i/${picture.hash}.png`)).status).toBe(200)
    expect(env.db.prepare('select user_id from blobs where hash = ?').all(picture.hash)).toEqual([
      { user_id: (await me(other)).json.user?.id },
    ])
  })
  test('a picture a stranger held too is handed over when the stranger goes', async () => {
    const other = await signIn(env, OTHER)
    const stranger = await signIn(env, 'stranger@example.com')
    const theirs = (await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })).json.space
      ?.id
    await joined(env, other, theirs ?? '', ME, 'write', { as: token })
    const picture = file(3, 11)
    for (const as of [token, stranger]) {
      await call(env, `/v1/blobs/${picture.hash}`, {
        method: 'PUT',
        token: as,
        raw: picture.bytes,
        headers: { 'content-type': 'image/png' },
      })
    }
    await call(env, `/v1/spaces/${theirs}/notes`, {
      token,
      body: {
        path: 'with a picture.md',
        content: `![](https://orden.so/i/${picture.hash}.png)`,
      },
    })
    expect((await leave()).status).toBe(200)
    expect((await leave(stranger)).status).toBe(200)
    expect((await call(env, `/i/${picture.hash}.png`)).status).toBe(200)
    expect(env.db.prepare('select user_id from blobs where hash = ?').all(picture.hash)).toEqual([
      { user_id: (await me(other)).json.user?.id },
    ])
  })
  test('a picture taken out of the owner’s note again is not handed over', async () => {
    const other = await signIn(env, OTHER)
    const theirs = (await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })).json.space
      ?.id
    await joined(env, other, theirs ?? '', ME, 'write', { as: token })
    const picture = file(3, 12)
    await call(env, `/v1/blobs/${picture.hash}`, {
      method: 'PUT',
      token,
      raw: picture.bytes,
      headers: { 'content-type': 'image/png' },
    })
    const note = (
      await call<LeavingView>(env, `/v1/spaces/${theirs}/notes`, {
        token,
        body: {
          path: 'with a picture.md',
          content: `![](https://orden.so/i/${picture.hash}.png)`,
        },
      })
    ).json.note
    const edited = await call(env, `/v1/notes/${note?.id}`, {
      method: 'PUT',
      token,
      body: { content: 'no picture now', baseVersion: note?.version },
    })
    expect(edited.status).toBe(200)
    await call(env, `/v1/spaces/${theirs}/share/me`, { method: 'DELETE', token })
    expect((await leave()).status).toBe(200)
    expect(env.db.prepare('select user_id from blobs where hash = ?').all(picture.hash)).toEqual([])
    expect((await call(env, `/i/${picture.hash}.png`)).status).toBe(404)
  })
  test('a paper it hung in a space it has since left is handed over too', async () => {
    const other = await signIn(env, OTHER)
    const theirs = (await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })).json.space
      ?.id
    await joined(env, other, theirs ?? '', ME, 'write', { as: token })
    const pages = (
      await call<LeavingView>(env, `/v1/spaces/${theirs}/notes`, {
        token,
        body: { path: 'Lecture.pages', content: '{}' },
      })
    ).json.note?.id
    const bytes = new TextEncoder().encode('%PDF-1.4\nanother lecture\n%%EOF\n')
    const hash = createHash('sha256').update(bytes).digest('hex')
    await call(env, `/v1/blobs/${hash}`, {
      method: 'PUT',
      token,
      raw: bytes,
      headers: { 'content-type': 'application/pdf' },
    })
    await call(env, `/v1/notes/${pages}/paper`, { method: 'PUT', token, body: { hash } })
    await call(env, `/v1/spaces/${theirs}/share/me`, { method: 'DELETE', token })
    expect((await leave()).status).toBe(200)
    expect((await call(env, `/v1/notes/${pages}/paper`, { token: other })).status).toBe(200)
    expect(env.db.prepare('select user_id from blobs where hash = ?').all(hash)).toEqual([
      { user_id: (await me(other)).json.user?.id },
    ])
  })
  test('a picture in a note not yet read by the sweep is found in its body', async () => {
    const other = await signIn(env, OTHER)
    const theirs = (await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })).json.space
      ?.id
    const sent = await mail(() =>
      call(env, `/v1/spaces/${theirs}/share/invite`, {
        token: other,
        body: { email: ME, role: 'write' },
      }),
    )
    await call(env, `/v1/join/${/\/join\/([a-f0-9]+)/.exec(sent)?.[1]}`, {
      method: 'POST',
      token,
    })
    const picture = file(3, 13)
    await call(env, `/v1/blobs/${picture.hash}`, {
      method: 'PUT',
      token,
      raw: picture.bytes,
      headers: { 'content-type': 'image/png' },
    })
    const note = (
      await call<LeavingView>(env, `/v1/spaces/${theirs}/notes`, {
        token,
        body: {
          path: 'with a picture.md',
          content: `![](https://orden.so/i/${picture.hash}.png)`,
        },
      })
    ).json.note?.id
    env.db.prepare('delete from note_pictures where note_id = ?').run(note ?? '')
    env.db.prepare('update notes set front_rev = 1 where id = ?').run(note ?? '')
    expect((await leave()).status).toBe(200)
    expect(env.db.prepare('select user_id from blobs where hash = ?').all(picture.hash)).toEqual([
      { user_id: (await me(other)).json.user?.id },
    ])
  })
  test.each([
    ['in a code span', (hash: string) => `see \`/i/${hash}\``],
    ['in prose', (hash: string) => `see /i/${hash} there`],
    ['as a picture', (hash: string) => `![](https://orden.so/i/${hash}.png)`],
  ])('a paper whose hash a stranger writes %s is not handed to them', async (_, body) => {
    const stranger = await signIn(env, OTHER)
    const mine = (await call<LeavingView>(env, '/v1/spaces', { token, body: { name: 'Mine' } })).json.space?.id
    const pages = (
      await call<LeavingView>(env, `/v1/spaces/${mine}/notes`, {
        token,
        body: { path: 'L.pages', content: '{}' },
      })
    ).json.note?.id
    const bytes = new TextEncoder().encode('%PDF-1.4\nprivate\n%%EOF\n')
    const hash = createHash('sha256').update(bytes).digest('hex')
    await call(env, `/v1/blobs/${hash}`, {
      method: 'PUT',
      token,
      raw: bytes,
      headers: { 'content-type': 'application/pdf' },
    })
    await call(env, `/v1/notes/${pages}/paper`, { method: 'PUT', token, body: { hash } })
    const theirs = (await call<LeavingView>(env, '/v1/spaces', { token: stranger, body: { name: 'Theirs' } })).json
      .space?.id
    await call(env, `/v1/spaces/${theirs}/notes`, {
      token: stranger,
      body: { path: 'n.md', content: body(hash) },
    })
    expect((await leave()).status).toBe(200)
    expect(env.db.prepare('select user_id from blobs where hash = ?').all(hash)).toEqual([])
  })
  test.each(['a page note', 'a space'])('a paper in %s emptied for good is not handed over', async (what) => {
    const other = await signIn(env, OTHER)
    const theirs = (await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })).json.space
      ?.id
    await joined(env, other, theirs ?? '', ME, 'write', { as: token })
    const bytes = new TextEncoder().encode('%PDF-1.4\nemptied\n%%EOF\n')
    const hash = createHash('sha256').update(bytes).digest('hex')
    await call(env, `/v1/blobs/${hash}`, {
      method: 'PUT',
      token,
      raw: bytes,
      headers: { 'content-type': 'application/pdf' },
    })
    if (what === 'a page note') {
      const pages = (
        await call<LeavingView>(env, `/v1/spaces/${theirs}/notes`, {
          token,
          body: { path: 'L.pages', content: '{}' },
        })
      ).json.note?.id
      await call(env, `/v1/notes/${pages}/paper`, { method: 'PUT', token, body: { hash } })
      await call(env, `/v1/notes/${pages}`, { method: 'DELETE', token: other })
      const purged = await call(env, `/v1/trash/notes/${pages}`, {
        method: 'DELETE',
        token: other,
      })
      expect(purged.status).toBe(200)
    } else {
      const listed = await call(env, `/v1/spaces/${theirs}/files`, {
        method: 'PUT',
        token,
        body: { files: [{ path: 'a.pdf', hash }] },
      })
      expect(listed.status).toBe(200)
      await call(env, `/v1/spaces/${theirs}`, { method: 'DELETE', token: other })
      const purged = await call(env, `/v1/trash/spaces/${theirs}`, {
        method: 'DELETE',
        token: other,
      })
      expect(purged.status).toBe(200)
    }
    expect((await leave()).status).toBe(200)
    expect(env.db.prepare('select user_id from blobs where hash = ?').all(hash)).toEqual([])
  })
  test('a picture a stranger holds as a PDF is handed over all the same', async () => {
    const other = await signIn(env, OTHER)
    const stranger = await signIn(env, 'stranger@example.com')
    const theirs = (await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })).json.space
      ?.id
    const sent = await mail(() =>
      call(env, `/v1/spaces/${theirs}/share/invite`, {
        token: other,
        body: { email: ME, role: 'write' },
      }),
    )
    await call(env, `/v1/join/${/\/join\/([a-f0-9]+)/.exec(sent)?.[1]}`, {
      method: 'POST',
      token,
    })
    const picture = file(3, 14)
    for (const [as, type] of [
      [token, 'image/png'],
      [stranger, 'application/pdf'],
    ] as const) {
      await call(env, `/v1/blobs/${picture.hash}`, {
        method: 'PUT',
        token: as,
        raw: picture.bytes,
        headers: { 'content-type': type },
      })
    }
    await call(env, `/v1/spaces/${theirs}/notes`, {
      token,
      body: {
        path: 'with a picture.md',
        content: `![](https://orden.so/i/${picture.hash}.png)`,
      },
    })
    expect((await leave()).status).toBe(200)
    await call(env, `/v1/blobs/${picture.hash}`, { method: 'DELETE', token: stranger })
    expect((await call(env, `/i/${picture.hash}.png`)).status).toBe(200)
  })
  test.each([
    [
      'a card on a canvas',
      'Board.canvas',
      (url: string) => JSON.stringify({ nodes: [{ id: 'a', type: 'file', file: url }], edges: [] }),
    ],
    ['a cover', 'Covered.md', (url: string) => `---\ncover: ${url}\n---\nWords.\n`],
  ])('a picture it put into somebody else’s space as %s is handed over', async (_, path, body) => {
    const other = await signIn(env, OTHER)
    const theirs = (await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })).json.space
      ?.id
    await joined(env, other, theirs ?? '', ME, 'write', { as: token })
    const picture = file(3, 15)
    await call(env, `/v1/blobs/${picture.hash}`, {
      method: 'PUT',
      token,
      raw: picture.bytes,
      headers: { 'content-type': 'image/png' },
    })
    const made = await call(env, `/v1/spaces/${theirs}/notes`, {
      token,
      body: { path, content: body(`https://orden.so/i/${picture.hash}.png`) },
    })
    expect(made.status).toBe(201)
    await call(env, `/v1/spaces/${theirs}/share/me`, { method: 'DELETE', token })
    expect((await leave()).status).toBe(200)
    expect((await call(env, `/i/${picture.hash}.png`)).status).toBe(200)
  })
  test('a picture of its own is not handed to a big space it only reads', async () => {
    const other = await signIn(env, OTHER)
    const big = (await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Big' } })).json.space?.id
    if (!big) throw new Error('no space was made')
    await call(env, `/v1/spaces/${big}/notes`, {
      token: other,
      body: { path: 'n0.md', content: 'hello' },
    })
    const row = env.db.prepare('select seq, updated_at, hash from notes where space_id = ?').get(big) as {
      seq: number
      updated_at: number
      hash: string
    }
    for (let at = 1; at < 260; at++) {
      env.db
        .prepare('insert into notes (id, space_id, path, seq, updated_at, size, hash) values (?, ?, ?, ?, ?, ?, ?)')
        .run(`n${String(at)}`, big, `n${String(at)}.md`, row.seq + at, row.updated_at, 5, row.hash)
    }
    await joined(env, other, big, ME, 'read', { as: token })
    const own = (await call<LeavingView>(env, '/v1/spaces', { token, body: { name: 'Mine' } })).json.space?.id
    const picture = file(3, 9)
    await call(env, `/v1/blobs/${picture.hash}`, {
      method: 'PUT',
      token,
      raw: picture.bytes,
      headers: { 'content-type': 'image/png' },
    })
    await call(env, `/v1/spaces/${own}/notes`, {
      token,
      body: { path: 'diary.md', content: `![](https://orden.so/i/${picture.hash}.png)` },
    })
    expect((await leave()).status).toBe(200)
    expect(env.db.prepare('select user_id from blobs where hash = ?').all(picture.hash)).toEqual([])
    expect((await call(env, `/i/${picture.hash}.png`)).status).toBe(404)
  })
  test('a published site stops answering', async () => {
    const space = (await call<LeavingView>(env, '/v1/spaces', { token, body: { name: 'Site' } })).json.space?.id
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'index.md', content: '# Hello' },
    })
    await call(env, `/v1/spaces/${space}/blog`, {
      method: 'PUT',
      token,
      body: { subdomain: 'leaving' },
    })
    const host = 'leaving.orden.so'
    expect((await call(env, '/', { host })).status).toBe(200)
    expect((await leave()).status).toBe(200)
    expect((await call(env, '/', { host })).status).toBe(302)
  })
})
