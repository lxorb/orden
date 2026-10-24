/** Deleting an account, through the routes: what it takes to be allowed, and what
 *  is left afterwards. The list of tables it empties is held to the schema in
 *  erase.test.ts; this file is about the door and about the people on either side
 *  of a share. */

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { codeAt } from '../src/second'
import { call, file, mail, signIn, type Answer, type TestEnv, testEnv } from './harness'

interface LeavingView {
  resendIn?: number
  second?: boolean
  ticket?: string
  ok?: boolean
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

/** The secret the second factor is kept under; see second.test.ts. */
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

/** Step one, what it answered, and the six digits and the words it mailed. */
async function askToLeave(
  as = token,
): Promise<{ answer: Answer<LeavingView>; code: string; mailed: string }> {
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

/** All three steps, for an account with no second factor. */
async function leave(as = token): Promise<Answer<LeavingView>> {
  const { code } = await askToLeave(as)
  const { json } = await verify(code, undefined, as)
  return await confirm(json.ticket, as)
}

/** Some other six digits than these. */
function wrong(code: string): string {
  return code.replace(/^./, (digit) => String((Number(digit) + 1) % 10))
}

async function me(as = token) {
  return await call<LeavingView>(env, '/v1/me', { token: as })
}

/** The second factor, turned on the way the pane turns it on; answers the secret. */
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
    // The session that asked went with everything else.
    expect((await me()).status).toBe(401)
  })

  test('and says so to the address afterwards', async () => {
    const { code } = await askToLeave()
    const { json } = await verify(code)

    const receipt = await mail(() => confirm(json.ticket))

    expect(receipt).toContain(ME)
    expect(receipt).toContain('Your Orden account has been deleted')
    // A receipt counts against nothing, so it writes nothing at the address.
    expect(env.db.prepare('select count(*) as many from limits where key = ?').get(ME)).toEqual({
      many: 0,
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

    // And it is still good for the account it was earned by.
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

    // The mailed code survives a mistyped second one, as a sign-in's does.
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

    const space = (await call<LeavingView>(env, '/v1/spaces', { token, body: { name: 'Open' } }))
      .json.space?.id
    const linked = await call<{ link: { url: string } }>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token,
      body: { role: 'write', mode: 'open' },
    })
    const link = /\/join\/([a-f0-9]+)/.exec(linked.json.link.url)?.[1]
    const guest = (await call<LeavingView>(env, `/v1/join/${link}`, { method: 'POST', body: {} }))
      .json.token

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

describe('what is left', () => {
  test('nothing of the account, and the address signs up as somebody new', async () => {
    const before = (await me()).json.user?.id
    const space = (await call<LeavingView>(env, '/v1/spaces', { token, body: { name: 'Work' } }))
      .json.space?.id
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
    // Not even as a marker: a fresh account has no deleted spaces to tell a
    // machine about.
    expect(listed.json.deleted).toEqual([])
  })

  test('a space somebody shared with it stays theirs, with its notes, without it', async () => {
    const other = await signIn(env, OTHER)
    const theirs = (
      await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })
    ).json.space?.id

    const sent = await mail(() =>
      call(env, `/v1/spaces/${theirs}/share/invite`, {
        token: other,
        body: { email: ME, role: 'write' },
      }),
    )
    const link = /\/join\/([a-f0-9]+)/.exec(sent)?.[1]
    await call(env, `/v1/join/${link}`, { method: 'POST', token })

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
    const theirs = (
      await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })
    ).json.space?.id
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
    const mine = (await call<LeavingView>(env, '/v1/spaces', { token, body: { name: 'Mine' } }))
      .json.space?.id
    const note = (
      await call<LeavingView>(env, `/v1/spaces/${mine}/notes`, {
        token,
        body: { path: 'shared.md', content: 'x' },
      })
    ).json.note?.id

    const sent = await mail(() =>
      call(env, `/v1/spaces/${mine}/share/invite`, { token, body: { email: OTHER, role: 'read' } }),
    )
    const link = /\/join\/([a-f0-9]+)/.exec(sent)?.[1]
    await call(env, `/v1/join/${link}`, { method: 'POST', token: other })
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
    const theirs = (
      await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })
    ).json.space?.id

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
      body: { path: 'with a picture.md', content: `![](https://nibeditor.com/i/${pasted}.png)` },
    })

    expect((await leave()).status).toBe(200)

    expect((await call(env, `/i/${pasted}.png`)).status).toBe(200)
    expect(env.db.prepare('select user_id from blobs where hash = ?').all(pasted)).toEqual([
      { user_id: (await me(other)).json.user?.id },
    ])
    // Only what that space shows: the one it never used went with the account.
    expect((await call(env, `/i/${kept}.png`)).status).toBe(404)
  })

  test('a paper it hung on a page note in a space that stays is handed to that space’s owner', async () => {
    const other = await signIn(env, OTHER)
    const theirs = (
      await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })
    ).json.space?.id

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

  /** And by somebody who wrote it there and may only read there now: they are still in
   *  the space, and what they put into it is still in its notes. */
  test('a picture it put into a space it may now only read is handed over too', async () => {
    const other = await signIn(env, OTHER)
    const theirs = (
      await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })
    ).json.space?.id

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
        content: `![](https://nibeditor.com/i/${picture.hash}.png)`,
      },
    })
    const demoted = await call(
      env,
      `/v1/spaces/${theirs}/share/members/${encodeURIComponent(ME)}`,
      { method: 'PATCH', token: other, body: { role: 'read' } },
    )
    expect(demoted.status).toBe(200)

    expect((await leave()).status).toBe(200)

    expect((await call(env, `/i/${picture.hash}.png`)).status).toBe(200)
    expect(env.db.prepare('select user_id from blobs where hash = ?').all(picture.hash)).toEqual([
      { user_id: (await me(other)).json.user?.id },
    ])
  })

  /** Taken out of the space, or gone of its own accord: either way nothing says it is in
   *  the space any more, and the picture it put there is still in the owner's note. */
  test.each([
    ['been taken out of', 'members'],
    ['left', 'me'],
  ])('a picture it put into a space it has since %s is handed over too', async (_, how) => {
    const other = await signIn(env, OTHER)
    const theirs = (
      await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })
    ).json.space?.id

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
        content: `![](https://nibeditor.com/i/${picture.hash}.png)`,
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

  /** Somebody who never shared anything with the owner kept the picture alive for a
   *  while, by holding the same bytes; when they go, it is the owner's note it is in. */
  test('a picture a stranger held too is handed over when the stranger goes', async () => {
    const other = await signIn(env, OTHER)
    const stranger = await signIn(env, 'stranger@example.com')
    const theirs = (
      await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })
    ).json.space?.id

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
        content: `![](https://nibeditor.com/i/${picture.hash}.png)`,
      },
    })

    expect((await leave()).status).toBe(200)
    expect((await leave(stranger)).status).toBe(200)

    expect((await call(env, `/i/${picture.hash}.png`)).status).toBe(200)
    expect(env.db.prepare('select user_id from blobs where hash = ?').all(picture.hash)).toEqual([
      { user_id: (await me(other)).json.user?.id },
    ])
  })

  /** What a note showed once and no longer does is not the space's: the owner is handed
   *  what its notes show now. */
  test('a picture taken out of the owner’s note again is not handed over', async () => {
    const other = await signIn(env, OTHER)
    const theirs = (
      await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })
    ).json.space?.id

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
          content: `![](https://nibeditor.com/i/${picture.hash}.png)`,
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

  /** And a paper, which a row names: whoever hung it there, and whether or not they are
   *  still in the space. */
  test('a paper it hung in a space it has since left is handed over too', async () => {
    const other = await signIn(env, OTHER)
    const theirs = (
      await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })
    ).json.space?.id

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

  /** A note written before its pictures were written down has none yet, until the
   *  nightly sweep reads it: in a space this account is still in, its body is read. */
  test('a picture in a note not yet read by the sweep is found in its body', async () => {
    const other = await signIn(env, OTHER)
    const theirs = (
      await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })
    ).json.space?.id

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
          content: `![](https://nibeditor.com/i/${picture.hash}.png)`,
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

  /** A space too big to read hands over everything rather than guess, which is right
   *  only where this account could have put something: a reader who never wrote there
   *  keeps its own pictures to itself, and they go with it. */
  test('a picture of its own is not handed to a big space it only reads', async () => {
    const other = await signIn(env, OTHER)
    const big = (
      await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Big' } })
    ).json.space?.id
    if (!big) throw new Error('no space was made')
    await call(env, `/v1/spaces/${big}/notes`, {
      token: other,
      body: { path: 'n0.md', content: 'hello' },
    })
    const row = env.db
      .prepare('select seq, updated_at, hash from notes where space_id = ?')
      .get(big) as { seq: number; updated_at: number; hash: string }
    for (let at = 1; at < 260; at++) {
      env.db
        .prepare(
          'insert into notes (id, space_id, path, seq, updated_at, size, hash) values (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(`n${String(at)}`, big, `n${String(at)}.md`, row.seq + at, row.updated_at, 5, row.hash)
    }
    const sent = await mail(() =>
      call(env, `/v1/spaces/${big}/share/invite`, {
        token: other,
        body: { email: ME, role: 'read' },
      }),
    )
    await call(env, `/v1/join/${/\/join\/([a-f0-9]+)/.exec(sent)?.[1]}`, {
      method: 'POST',
      token,
    })

    const own = (await call<LeavingView>(env, '/v1/spaces', { token, body: { name: 'Mine' } })).json
      .space?.id
    const picture = file(3, 9)
    await call(env, `/v1/blobs/${picture.hash}`, {
      method: 'PUT',
      token,
      raw: picture.bytes,
      headers: { 'content-type': 'image/png' },
    })
    await call(env, `/v1/spaces/${own}/notes`, {
      token,
      body: { path: 'diary.md', content: `![](https://nibeditor.com/i/${picture.hash}.png)` },
    })

    expect((await leave()).status).toBe(200)

    expect(env.db.prepare('select user_id from blobs where hash = ?').all(picture.hash)).toEqual([])
    expect((await call(env, `/i/${picture.hash}.png`)).status).toBe(404)
  })

  test('a published site stops answering', async () => {
    const space = (await call<LeavingView>(env, '/v1/spaces', { token, body: { name: 'Site' } }))
      .json.space?.id
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'index.md', content: '# Hello' },
    })
    await call(env, `/v1/spaces/${space}/blog`, {
      method: 'PUT',
      token,
      body: { subdomain: 'leaving' },
    })

    const host = 'leaving.nibeditor.com'
    expect((await call(env, '/', { host })).status).toBe(200)

    expect((await leave()).status).toBe(200)

    expect((await call(env, '/', { host })).status).toBe(302)
  })
})
