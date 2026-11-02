/** What emptying Recently deleted leaves behind, which is nothing (#457, #467).
 *
 *  A note's id names more than its row: its room, which holds the whole document; the
 *  chat its `.chat` file opens; who it was shared with. A purge takes all of them, and
 *  an id whose row went for good is not one anybody may make something under again
 *  while anything it named is still there. */

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { type PullResponse, type PushResponse, seedUpdate } from '@orden/sync-core'
import { TEXT } from '@orden/rooms'
import * as Y from 'yjs'
import { sweepChats } from '../src/chats/sweep'
import { sweepLeftovers } from '../src/leftovers'
import { purgeExpired } from '../src/trash'
import { call, mail, type ShareView, signIn, type TestEnv, testEnv } from './harness'
import { FakeSocket } from './room'
import { framed, type Live, live } from './sync2'

let env: TestEnv
let rooms: Live
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  rooms = live(env)
  token = await signIn(env, 'owner@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Secrets' } })).json.space.id
})

afterEach(() => env.close())

/** A note on sync v2 whose room holds an edit that went through it. */
async function heldInARoom(path: string, text: string, typed: string): Promise<string> {
  const id = (
    await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content: text } })
  ).json.note.id
  await call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' })

  const doc = new Y.Doc()
  Y.applyUpdateV2(doc, seedUpdate(id, 1, text))
  const base = Y.encodeStateVector(doc)
  doc.getText(TEXT).insert(0, typed)
  const update = Y.encodeStateAsUpdateV2(doc, base)

  const { value } = await framed<PushResponse>(env, '/v2/docs/push', token, {
    docs: [{ id, push: `owner-${id}`, epoch: 1, seq: 1, base, update, at: 1 }],
  })
  expect(value.docs[0]).toMatchObject({ ok: true })
  await rooms.settle()
  return id
}

/** Somebody else's account, with a space of its own on sync v2. */
async function anotherAccount(): Promise<{ token: string; space: string }> {
  const other = await signIn(env, 'other@example.com')
  const theirs = (await call(env, '/v1/spaces', { token: other, body: { name: 'Mine' } })).json
    .space.id
  await call(env, `/v2/spaces/${theirs}/prepare`, { token: other, method: 'POST' })
  return { token: other, space: theirs }
}

function createUnder(as: { token: string; space: string }, id: string, op = `make-${id}`) {
  return call<{ results: Record<string, unknown>[] }>(env, `/v2/spaces/${as.space}/ops`, {
    token: as.token,
    body: { ops: [{ op, t: 'create', id, kind: 'note', parent: null, name: 'Mine.md', seen: 0 }] },
  })
}

function kept(id: string): number {
  return rooms.of(id).state.kept.size
}

describe('a space purged from Recently deleted', () => {
  async function purged(): Promise<string> {
    const id = await heldInARoom('Secret.md', 'one\nTOP SECRET\n', 'x')
    expect(kept(id)).toBeGreaterThan(0)

    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })
    expect((await call(env, `/v1/trash/spaces/${space}`, { method: 'DELETE', token })).status).toBe(
      200,
    )
    return id
  }

  test('lets nobody else make a note under one of its ids', async () => {
    const id = await purged()
    const other = await anotherAccount()

    const made = await createUnder(other, id)
    expect(made.status).toBe(200)
    expect(made.json.results[0]).toMatchObject({ refused: 'gone' })

    // And nothing was made: a push to it is a push to nothing.
    const doc = new Y.Doc()
    doc.getText(TEXT).insert(0, 'y')
    const { value } = await framed<PushResponse>(env, '/v2/docs/push', other.token, {
      docs: [
        {
          id,
          push: 'other-1',
          epoch: 1,
          seq: 0,
          base: new Uint8Array([0]),
          update: Y.encodeStateAsUpdateV2(doc),
          at: 1,
        },
      ],
    })
    expect(value.docs[0]).toMatchObject({ refused: 'gone' })
    expect(JSON.stringify(value)).not.toContain('SECRET')
  })

  test('empties its notes’ rooms, and frees an id only once its room is empty', async () => {
    const id = await purged()
    expect(env.db.prepare('select id from retired_notes').all()).toEqual([{ id }])

    await sweepLeftovers(env)
    expect(kept(id)).toBe(0)
    expect(env.db.prepare('select count(*) as many from retired_notes').get()).toEqual({ many: 0 })
  })

  test('writes down the bodies of its notes’ versions', async () => {
    const id = await purged()
    const listed = env.db
      .prepare("select what from leftovers where what like 'versions/%'")
      .all() as { what: string }[]
    expect(listed.length).toBeGreaterThan(0)
    expect(
      env.db.prepare('select count(*) as many from note_versions where note_id = ?').get(id),
    ).toEqual({ many: 0 })
  })

  test('takes away who it was shared with, and a guest that was in nothing else', async () => {
    const shared = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token,
      body: { role: 'read', mode: 'open' },
    })
    const link = /\/join\/([a-f0-9]+)/.exec(shared.json.link?.url ?? '')?.[1] ?? ''
    const guest = await call(env, `/v1/join/${link}`, { method: 'POST' })
    expect((await call(env, '/v1/me', { token: guest.json.token })).status).toBe(200)

    await purged()

    for (const table of ['space_members', 'space_links', 'space_requests', 'guest_members']) {
      expect(
        env.db.prepare(`select count(*) as many from ${table} where space_id = ?`).get(space),
        table,
      ).toEqual({ many: 0 })
    }
    expect((await call(env, '/v1/me', { token: guest.json.token })).status).toBe(401)
  })

  test('ends its chats', async () => {
    env.db
      .prepare("insert into chats (id, space_id, created_at) values ('c_space', ?, 1)")
      .run(space)
    await purged()

    expect(env.db.prepare("select ended_at from chats where id = 'c_space'").get()).not.toEqual({
      ended_at: null,
    })
  })
})

describe('a note purged from Recently deleted', () => {
  async function purged(): Promise<string> {
    const id = await heldInARoom('Secret.md', 'one\nPURGE ME\n', 'x')
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })
    expect((await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })).status).toBe(200)
    return id
  }

  test('is not pulled from its room, by anybody', async () => {
    const id = await purged()

    const { value } = await framed<PullResponse>(env, '/v2/docs/pull', token, {
      docs: [{ id, epoch: 1, sv: new Uint8Array([0]) }],
    })
    expect(value.docs[0]).toMatchObject({ refused: 'gone' })
    expect(JSON.stringify(value)).not.toContain('PURGE')
  })

  test('has its room emptied by the sweep', async () => {
    const id = await purged()
    expect(kept(id)).toBeGreaterThan(0)

    await sweepLeftovers(env)
    expect(kept(id)).toBe(0)
  })

  test('keeps its id, so nobody makes a note under it - not even its own space', async () => {
    const id = await purged()
    await sweepLeftovers(env)

    expect((await createUnder({ token, space }, id)).json.results[0]).toMatchObject({
      refused: 'gone',
    })
    expect((await createUnder(await anotherAccount(), id)).json.results[0]).toMatchObject({
      refused: 'gone',
    })
  })

  test('ends the chat its file opened, then and at the nightly sweep', async () => {
    const id = await heldInARoom('Talk.md', 'one\n', 'x')
    env.db
      .prepare("insert into chats (id, space_id, file_id, created_at) values ('c_file', ?, ?, 1)")
      .run(space, id)
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })
    await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })

    const ended = () =>
      (
        env.db.prepare("select ended_at from chats where id = 'c_file'").get() as {
          ended_at: number | null
        }
      ).ended_at
    expect(ended()).not.toBeNull()

    // A chat a purge from before this ended nothing of is ended by the sweep.
    env.db.exec("update chats set ended_at = null where id = 'c_file'")
    await sweepChats(env, Date.now())
    expect(ended()).not.toBeNull()
  })
})

/** An id a purge retired is nothing a v1 write comes back through: on sync v2 a room could
 *  not settle what the tree hides, for ever, and on v1 the tombstone came back alive. */
describe('a write to a note purged since it was read', () => {
  test.each([
    ['on sync v1', false],
    ['on sync v2', true],
  ])('is answered as a note that is not there, %s', async (_, v2) => {
    const id = (
      await call(env, `/v1/spaces/${space}/notes`, {
        token,
        body: { path: 'Gone.md', content: 'secret words' },
      })
    ).json.note.id
    if (v2) await call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' })
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })
    await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })
    const { version } = env.db.prepare('select version from notes where id = ?').get(id) as {
      version: number
    }

    const put = await call(env, `/v1/notes/${id}`, {
      token,
      method: 'PUT',
      body: { content: 'edited offline', baseVersion: version },
    })

    expect(put.status).toBe(404)
    expect(env.db.prepare('select deleted, deleted_at from notes where id = ?').get(id)).toEqual({
      deleted: 1,
      deleted_at: null,
    })
    expect((await call(env, `/v1/notes/${id}`, { token })).status).toBe(404)
  })
})

/** An erased room is one that holds nothing, including the object still in memory that the
 *  next join finds. */
describe('a room erased while its object lives', () => {
  test('hands the next socket none of its words, and what that socket types settles', async () => {
    const id = await heldInARoom('Gone.md', 'TOP SECRET\n', 'more ')
    const { room } = rooms.of(id)
    const join = { noteId: id, spaceId: space, kind: 'words' as const }
    const first = new FakeSocket()
    await room.enter(first as unknown as WebSocket, join)
    const memory = () => (room as unknown as { state: { doc: Y.Doc } }).state.doc
    expect(memory().getText(TEXT).toString()).toContain('TOP SECRET')

    const erased = await room.fetch(
      new Request('https://room/', { headers: { 'x-nib-erase': 'yes' } }),
    )
    expect(erased.status).toBe(204)
    expect(first.closed).toBe(true)
    expect(memory().getText(TEXT).toString()).toBe('')

    // Nothing of the old document, and a room that opens again: `held` is what a settle
    // writes from.
    await env.NOTES.delete(`spaces/${space}/${id}`)
    env.db.prepare("update notes set epoch = 0, epoch_base = '' where id = ?").run(id)
    const next = new FakeSocket()
    await room.enter(next as unknown as WebSocket, join)
    expect(next.closed).toBe(false)
    expect(memory().getText(TEXT).toString()).toBe('')
    expect((room as unknown as { held: unknown }).held).not.toBeNull()
  })
})

/** A purge and a restore of one note are two requests, and each reads the row before it
 *  writes it. Whichever way round they land the note is either whole or gone: never a
 *  live note with nothing in it (#473). */
describe('a note restored and purged at once', () => {
  interface Row {
    deleted: number
    deleted_at: number | null
    hash: string
    size: number
  }

  const row = (id: string) =>
    env.db.prepare('select deleted, deleted_at, hash, size from notes where id = ?').get(id) as Row

  /** `work` run at the moment the next batch is about to be written, after whatever
   *  that request read to decide on it. */
  function beforeNextBatch(work: () => Promise<unknown>) {
    const real = env.DB.batch.bind(env.DB)
    let waiting = true
    env.DB.batch = async (statements: D1PreparedStatement[]) => {
      if (waiting) {
        waiting = false
        await work()
      }
      return await real(statements)
    }
  }

  async function deleted(path: string): Promise<string> {
    const id = await heldInARoom(path, 'one\nKEEP ME\n', 'x')
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })
    return id
  }

  async function deletedOnV1(path: string): Promise<string> {
    const id = (
      await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content: 'KEEP ME' } })
    ).json.note.id
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })
    return id
  }

  test('the restore first, as the purge is starting: it stays, whole', async () => {
    const id = await deleted('Both.md')
    const before = row(id)
    // Past the purge's own look at the row and before anything it does about it.
    env.justBefore(/select kind, hash, paper, front_rev, size/, () => {
      env.db.prepare('update notes set deleted = 0, deleted_at = null where id = ?').run(id)
    })

    const purge = await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })

    expect(purge.status).toBe(404)
    expect(row(id)).toMatchObject({ deleted: 0, hash: before.hash, size: before.size })
    expect(env.keys()).toContain(`spaces/${space}/${id}`)
    expect((await call(env, `/v1/notes/${id}`, { token })).json.content).toContain('KEEP ME')

    // And what the purge wrote down before it asked is not taken from a note that stayed.
    await sweepLeftovers(env)
    expect(env.keys()).toContain(`spaces/${space}/${id}`)
    expect((await call(env, `/v1/notes/${id}`, { token })).json.content).toContain('KEEP ME')
  })

  test('the purge first, under a tree batch: the note stays gone', async () => {
    const id = await deleted('Both.md')
    beforeNextBatch(() => call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token }))

    const answer = await call<{ results: Record<string, unknown>[] }>(
      env,
      `/v2/spaces/${space}/ops`,
      { token, body: { ops: [{ op: 'back', t: 'restore', id, seen: 1_000_000 }] } },
    )

    expect(answer.status).toBe(200)
    expect(answer.json.results[0]).toMatchObject({ refused: 'gone' })
    expect(row(id)).toMatchObject({ deleted: 1, deleted_at: null, hash: '', size: 0 })
  })

  test('the purge first, under Recently deleted’s restore: the same', async () => {
    const id = await deleted('Both.md')
    beforeNextBatch(() => call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token }))

    const back = await call(env, `/v1/trash/notes/${id}/restore`, { method: 'POST', token })

    expect(back.status).toBe(404)
    expect(row(id)).toMatchObject({ deleted: 1, deleted_at: null, hash: '', size: 0 })
  })

  test('and on a v1 tree, whose restore is a row written by path', async () => {
    const id = await deletedOnV1('Old.md')
    beforeNextBatch(() => call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token }))

    const back = await call(env, `/v1/trash/notes/${id}/restore`, { method: 'POST', token })

    expect(back.status).toBe(404)
    expect(row(id)).toMatchObject({ deleted: 1, deleted_at: null, hash: '', size: 0 })
  })

  test('a batch sent after the purge is refused too', async () => {
    const id = await deleted('Both.md')
    await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })

    const answer = await call<{ results: Record<string, unknown>[] }>(
      env,
      `/v2/spaces/${space}/ops`,
      { token, body: { ops: [{ op: 'back', t: 'restore', id, seen: 1_000_000 }] } },
    )

    expect(answer.json.results[0]).toMatchObject({ refused: 'gone' })
    expect(row(id)).toMatchObject({ deleted: 1, hash: '' })
  })

  /** The row says it is gone before the bucket is asked, so the bucket saying no leaves
   *  nothing in Recently deleted to tap again: the sweep is what comes back for it. */
  test('bytes the bucket would not give up go at the next sweep', async () => {
    const id = await deleted('Stuck.md')
    const bucket = env.NOTES as unknown as { delete(keys: string | string[]): Promise<void> }
    const real = bucket.delete.bind(bucket)
    let failing = true
    bucket.delete = (keys) => {
      if (!failing || !keys.includes(`spaces/${space}/${id}`)) return real(keys)
      failing = false
      return Promise.reject(new Error('the bucket is not answering'))
    }

    const purge = await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })

    expect(purge.status).toBe(200)
    expect(row(id)).toMatchObject({ deleted: 1, deleted_at: null, hash: '' })
    expect(env.keys()).toContain(`spaces/${space}/${id}`)

    await sweepLeftovers(env)
    expect(env.keys()).not.toContain(`spaces/${space}/${id}`)
    expect(env.keys()).not.toContain(`crdt/${id}`)
  })
})

/** A purge is one transaction, so it finishes or leaves the note in Recently deleted to
 *  be purged again; anything left half done is words somebody asked to have gone, or
 *  storage nothing would ever take back. */
describe('a purge the database fails part way', () => {
  const HASH = 'c'.repeat(64)

  /** A note deleted with a row in everything a purge has to take away. */
  async function held(path = 'Held.md'): Promise<string> {
    const id = await heldInARoom(path, 'one\nKEEP ME\n', 'x')
    const at = 1
    const run = (sql: string, ...args: (string | number)[]) => {
      env.db.prepare(sql).run(...args)
    }
    run(
      `insert into note_search (note_id, space_id, path, title, body) values (?, ?, ?, 'T', 'WORDS')`,
      id,
      space,
      path,
    )
    run(
      `insert into push_reminders (note_id, id, user_id, space_id, at, title, body, path, hash, line)
       values (?, 'r', 'u', ?, ?, 'TASK', 'TASK', ?, 'h', 1)`,
      id,
      space,
      at,
      path,
    )
    run('insert into note_pictures (note_id, hash) values (?, ?)', id, HASH)
    run(
      `insert into note_versions (note_id, at, hash, size, by, held) values (?, ?, ?, 1, '', 0)`,
      id,
      at,
      versionOf(id),
    )
    await env.NOTES.put(`versions/${versionOf(id)}`, 'OLD WORDS')
    run(
      `insert into form_answers (id, space_id, note_id, at, answers, bytes) values (?, ?, ?, ?, '{}', 2)`,
      `form-${id}`,
      space,
      id,
      at,
    )
    run(
      'insert into blog_paths (space_id, slug, note_id, at) values (?, ?, ?, ?)',
      space,
      `old-${id}`,
      id,
      at,
    )
    run(
      `insert into space_members (space_id, email, item, role, created_at) values (?, 'm@example.com', ?, 'read', ?)`,
      space,
      id,
      at,
    )
    run(
      `insert into space_links (space_id, item, token, role, mode, created_at) values (?, ?, ?, 'read', 'open', ?)`,
      space,
      id,
      `token-${id}`,
      at,
    )
    run(
      `insert into space_requests (space_id, email, item, role, created_at) values (?, 'q@example.com', ?, 'read', ?)`,
      space,
      id,
      at,
    )
    run('insert into once_shared (space_id, item, at) values (?, ?, ?)', space, id, at)
    run(`insert into guests (id, name, created_at) values (?, 'Owl', ?)`, `guest-${id}`, at)
    run(
      `insert into guest_members (space_id, guest_id, item, role, joined_at, created_at) values (?, ?, ?, 'read', ?, ?)`,
      space,
      `guest-${id}`,
      id,
      at,
      at,
    )
    run(
      `insert into chats (id, space_id, file_id, created_at, last_seq, topic, posting, slowmode)
       values (?, ?, ?, ?, 0, '', 'writers', 0)`,
      `chat-${id}`,
      space,
      id,
      at,
    )
    run(
      `insert into term_sessions (term, machine, session, user_id, created_at) values (?, 'machine', ?, 'u', ?)`,
      id,
      `session-${id}`,
      at,
    )
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })
    return id
  }

  /** A hash of its own per note, so two notes do not hold one body between them. */
  const versionOf = (id: string) => createHash('sha256').update(id).digest('hex')

  const count = (sql: string, ...args: string[]) =>
    (env.db.prepare(sql).get(...args) as { held: number }).held

  /** How much of a note's is still there, table by table. */
  const remaining = (id: string) => ({
    search: count('select count(*) as held from note_search where note_id = ?', id),
    reminders: count('select count(*) as held from push_reminders where note_id = ?', id),
    pictures: count('select count(*) as held from note_pictures where note_id = ?', id),
    versions: count('select count(*) as held from note_versions where note_id = ?', id),
    answers: count('select count(*) as held from form_answers where note_id = ?', id),
    paths: count('select count(*) as held from blog_paths where note_id = ?', id),
    members: count('select count(*) as held from space_members where item = ?', id),
    links: count('select count(*) as held from space_links where item = ?', id),
    requests: count('select count(*) as held from space_requests where item = ?', id),
    invited: count('select count(*) as held from guest_members where item = ?', id),
    guests: count('select count(*) as held from guests where id = ?', `guest-${id}`),
    chats: count('select count(*) as held from chats where file_id = ? and ended_at is null', id),
    once: count('select count(*) as held from once_shared where item = ?', id),
    terms: count(
      'select count(*) as held from term_sessions where term = ? and ended_at is null',
      id,
    ),
  })

  const nothing = {
    search: 0,
    reminders: 0,
    pictures: 0,
    versions: 0,
    answers: 0,
    paths: 0,
    members: 0,
    links: 0,
    requests: 0,
    invited: 0,
    guests: 0,
    chats: 0,
    once: 0,
    terms: 0,
  }

  /** Every statement matching `sql` that names `only`, if that is given, failing as it
   *  runs, until the answer is called. */
  function failing(sql: RegExp, only?: string): () => void {
    const prepare = env.DB.prepare.bind(env.DB)
    let down = true
    env.DB.prepare = (text: string) => {
      const statement = prepare(text)
      if (!sql.test(text)) return statement
      const bind = statement.bind.bind(statement)
      const run = statement.run.bind(statement)
      let named = only === undefined
      statement.bind = (...args: unknown[]) => {
        named ||= args.some((one) => typeof one === 'string' && one.includes(only ?? ''))
        return bind(...args)
      }
      statement.run = (...args: []) =>
        down && named ? Promise.reject(new Error('D1 is not answering')) : run(...args)
      return statement
    }
    return () => {
      down = false
    }
  }

  test.each([
    ['who once held it', /delete from once_shared/],
    ['its reminders', /delete from push_reminders/],
    ['its pictures', /delete from note_pictures/],
    ['its versions', /delete from note_versions/],
    ['the blobs it stops using', /insert or ignore into unused_blobs/],
    ['what is left in the bucket and the room', /insert or ignore into leftovers/],
    ['its chat', /update chats set ended_at/],
    ['its form answers', /delete from form_answers/],
    ['its addresses', /delete from blog_paths/],
    ['its terminal session', /update term_sessions set ended_at/],
    ['who it was shared with', /delete from space_members/],
    ['its links', /delete from space_links/],
    ['who asked for it', /delete from space_requests/],
    ['its guests’ places', /delete from guest_members/],
    ['a guest with nothing left', /delete from guests/],
    ['the row', /update notes set size = 0/],
  ])('at %s leaves it to purge again', async (_, sql) => {
    const id = await held()
    const before = env.db.prepare('select hash, size from notes where id = ?').get(id)
    const whole = remaining(id)
    const body = (await env.NOTES.get(`spaces/${space}/${id}`))?.size
    const recovered = failing(sql)

    const first = await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })

    expect(first.status).toBe(500)
    // Still in Recently deleted, whole, and nothing of it taken.
    expect(env.db.prepare('select hash, size from notes where id = ?').get(id)).toEqual(before)
    expect(
      (await call(env, '/v1/trash', { token })).json.notes.map((one: { id: string }) => one.id),
    ).toEqual([id])
    expect((await env.NOTES.get(`spaces/${space}/${id}`))?.size).toBe(body)
    expect(await env.NOTES.get(`versions/${versionOf(id)}`)).not.toBe(null)
    expect(remaining(id)).toEqual(whole)

    recovered()
    const second = await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })

    expect(second.status).toBe(200)
    expect(remaining(id)).toEqual(nothing)
    expect(
      env.db.prepare('select deleted, deleted_at, hash, size from notes where id = ?').get(id),
    ).toEqual({ deleted: 1, deleted_at: null, hash: '', size: 0 })
    expect(env.keys()).not.toContain(`spaces/${space}/${id}`)
    expect(env.keys()).not.toContain(`versions/${versionOf(id)}`)
    expect(count('select count(*) as held from leftovers where what = ?', `rooms/${id}`)).toBe(1)
    expect(
      count('select count(*) as held from unused_blobs where hash = ?', HASH) +
        count('select count(*) as held from blobs where hash = ?', HASH),
    ).toBeLessThanOrEqual(1)
  })

  /** The index keeps a note's id in a column nothing can look up, so this statement reads
   *  all of it. In the transaction, an index grown too big for one statement would have
   *  kept every note from ever being purged. */
  describe('its words, which are not worth holding the rest up for', () => {
    const wordsLeft = (id: string) =>
      count('select count(*) as held from leftovers where what = ?', `words/${id}`)

    test('go with it when they can, and leave nothing to come back for', async () => {
      const id = await held()
      expect((await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })).status).toBe(
        200,
      )
      expect(remaining(id)).toEqual(nothing)
      expect(wordsLeft(id)).toBe(0)
    })

    test('and when they cannot, the purge stands and the sweep comes back', async () => {
      const id = await held()
      const recovered = failing(/delete from note_search/)

      expect((await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })).status).toBe(
        200,
      )
      expect(env.db.prepare('select deleted_at, hash from notes where id = ?').get(id)).toEqual({
        deleted_at: null,
        hash: '',
      })
      expect(remaining(id).search).toBeGreaterThan(0)
      expect(wordsLeft(id)).toBe(1)

      // And a sweep they fail in again keeps them, and holds up nothing else.
      await sweepLeftovers(env)
      expect(wordsLeft(id)).toBe(1)
      expect(env.keys()).not.toContain(`spaces/${space}/${id}`)
      expect(count('select count(*) as held from leftovers where what = ?', `rooms/${id}`)).toBe(0)

      recovered()
      await sweepLeftovers(env)
      expect(remaining(id).search).toBe(0)
      expect(wordsLeft(id)).toBe(0)
    })
  })

  /** A batch that answered and did not say it landed has not said anything was let go. */
  test('takes no bytes on a batch that says it did not land', async () => {
    const id = await held()
    const real = env.DB.batch.bind(env.DB)
    env.DB.batch = (async (statements: D1PreparedStatement[]) => {
      const answers = await real(statements)
      if (statements.length < 10) return answers
      return answers.map((one, at) => (at === 3 ? { ...one, success: false } : one))
    }) as typeof env.DB.batch

    const purge = await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })

    expect(purge.status).toBe(500)
    expect(env.keys()).toContain(`spaces/${space}/${id}`)
    expect(env.keys()).toContain(`versions/${versionOf(id)}`)
  })

  /** D1 takes two million bytes in one bound value, and a hash is 67 of them in a list: a
   *  note may name more pictures than one list holds, four megabytes of it being allowed. */
  test('fits what a note with every picture it can hold stopped using', async () => {
    const id = await held()
    const insert = env.db.prepare('insert into note_pictures (note_id, hash) values (?, ?)')
    env.db.exec('begin')
    for (let at = 0; at < 40_000; at++) insert.run(id, String(at).padStart(64, '0'))
    env.db.exec('commit')

    let widest = 0
    const prepare = env.DB.prepare.bind(env.DB)
    env.DB.prepare = (text: string) => {
      const statement = prepare(text)
      const bind = statement.bind.bind(statement)
      statement.bind = (...args: unknown[]) => {
        for (const one of args) if (typeof one === 'string') widest = Math.max(widest, one.length)
        return bind(...args)
      }
      return statement
    }

    expect((await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })).status).toBe(200)

    expect(widest).toBeLessThanOrEqual(2_000_000)
    expect(
      count('select count(*) as held from unused_blobs where hash like ?', '0%'),
    ).toBeGreaterThan(39_000)
  })

  test('whatever is past the transaction comes back at the sweep', async () => {
    const id = await held()
    const bucket = env.NOTES as unknown as { delete(keys: string | string[]): Promise<void> }
    const real = bucket.delete.bind(bucket)
    bucket.delete = () => Promise.reject(new Error('the bucket is not answering'))

    const purge = await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })

    expect(purge.status).toBe(200)
    expect(remaining(id)).toEqual(nothing)
    expect(env.keys()).toContain(`versions/${versionOf(id)}`)

    bucket.delete = real
    await sweepLeftovers(env)
    expect(env.keys()).not.toContain(`spaces/${space}/${id}`)
    expect(env.keys()).not.toContain(`crdt/${id}`)
    expect(env.keys()).not.toContain(`versions/${versionOf(id)}`)
  })

  test('nor does telling a machine what ended take the purge back', async () => {
    const id = await held()
    env.justBefore(/insert into machine_events/, () => {
      throw new Error('D1 is not answering')
    })

    const purge = await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })

    expect(purge.status).toBe(200)
    expect(remaining(id)).toEqual(nothing)
  })

  test('emptying the trash goes on past one that failed, and says so', async () => {
    const stuck = await held('Stuck.md')
    const fine = await held('Fine.md')
    const recovered = failing(/delete from form_answers/, stuck)

    const first = await call(env, '/v1/trash', { method: 'DELETE', token })

    expect(first.status).toBe(500)
    expect(remaining(fine)).toEqual(nothing)
    expect(env.db.prepare('select deleted_at from notes where id = ?').get(stuck)).not.toEqual({
      deleted_at: null,
    })

    recovered()
    expect((await call(env, '/v1/trash', { method: 'DELETE', token })).status).toBe(200)
    expect(remaining(stuck)).toEqual(nothing)
  })

  test('the nightly job goes on past one that failed, and the next night finishes it', async () => {
    const stuck = await held('Stuck.md')
    const fine = await held('Fine.md')
    env.db.prepare('update notes set deleted_at = 1 where id in (?, ?)').run(stuck, fine)
    const recovered = failing(/delete from form_answers/, stuck)

    await purgeExpired(env, Date.now())

    expect(remaining(fine)).toEqual(nothing)
    expect(env.db.prepare('select deleted_at from notes where id = ?').get(stuck)).toEqual({
      deleted_at: 1,
    })

    recovered()
    await purgeExpired(env, Date.now())
    expect(remaining(stuck)).toEqual(nothing)
  })

  /** Nothing is taken before the row is, so a restore that wins keeps all of it. */
  test('a restore landing just ahead of it keeps the history too', async () => {
    const id = await held()
    const whole = remaining(id)
    env.justBefore(/select kind, hash, paper, front_rev, size/, () => {
      env.db.prepare('update notes set deleted = 0, deleted_at = null where id = ?').run(id)
    })

    const purge = await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })

    expect(purge.status).toBe(404)
    expect(remaining(id)).toEqual(whole)
    expect(await env.NOTES.get(`versions/${versionOf(id)}`)).not.toBe(null)
    expect(env.keys()).toContain(`spaces/${space}/${id}`)
  })
})

describe('a v1 note deleted again', () => {
  /** A note on the v1 tree, which has no `name_key`: its delete is the route's own. */
  async function v1Note(): Promise<string> {
    return (
      await call(env, `/v1/spaces/${space}/notes`, {
        token,
        body: { path: 'Old.md', content: 'x' },
      })
    ).json.note.id
  }
  const row = (id: string) =>
    env.db
      .prepare('select deleted, deleted_at, version, name_key from notes where id = ?')
      .get(id) as {
      deleted: number
      deleted_at: number | null
      version: number
      name_key: string | null
    }

  test('keeps the days it already had in Recently deleted', async () => {
    const id = await v1Note()
    expect(row(id).name_key).toBeNull()
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })
    env.db.prepare('update notes set deleted_at = 1 where id = ?').run(id)
    const before = row(id)

    expect((await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })).status).toBe(200)
    expect(row(id)).toEqual(before)
  })

  test('once purged, stays a tombstone and never comes back to Recently deleted', async () => {
    const id = await v1Note()
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })
    await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })
    const before = row(id)
    expect(before.deleted_at).toBeNull()

    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })
    expect(row(id)).toEqual(before)
    expect(
      (await call(env, `/v1/trash/notes/${id}/restore`, { method: 'POST', token })).status,
    ).toBe(404)
  })
})

describe('an id made by another space', () => {
  test('is not made again in this one', async () => {
    const id = (
      await call(env, `/v1/spaces/${space}/notes`, {
        token,
        body: { path: 'Live.md', content: 'still here\n' },
      })
    ).json.note.id

    const made = await createUnder(await anotherAccount(), id)
    expect(made.status).toBe(200)
    expect(made.json.results[0]).toMatchObject({ refused: 'gone' })
  })

  test('is not made again as a folder, and the rest of the batch still applies', async () => {
    const mine = await anotherAccount()
    const folder = 'folder-of-mine'
    await call(env, `/v2/spaces/${mine.space}/ops`, {
      token: mine.token,
      body: { ops: [{ op: 'mine', t: 'mkdir', id: folder, parent: null, name: 'Mine', seen: 0 }] },
    })
    await call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' })

    const made = await call<{ results: Record<string, unknown>[] }>(
      env,
      `/v2/spaces/${space}/ops`,
      {
        token,
        body: {
          ops: [
            { op: 'theirs', t: 'mkdir', id: folder, parent: null, name: 'Theirs', seen: 0 },
            { op: 'fine', t: 'mkdir', id: 'folder-fine', parent: null, name: 'Fine', seen: 0 },
          ],
        },
      },
    )
    expect(made.status).toBe(200)
    expect(made.json.results[0]).toMatchObject({ refused: 'gone' })
    expect(made.json.results[1]).toMatchObject({ id: 'folder-fine' })
  })

  test('while a create this space already answered is answered the same again', async () => {
    const other = await anotherAccount()
    const first = await createUnder(other, 'mine-1', 'op-once')
    expect(first.json.results[0]).not.toHaveProperty('refused')

    const again = await createUnder(other, 'mine-1', 'op-once')
    expect(again.json.results[0]).toEqual(first.json.results[0])
  })
})

/** What is purged costs nothing (storage.ts): the bytes a purged note or space was the
 *  only use of stop counting against its owner, and go from the bucket once nobody
 *  holds them, while bytes something else of theirs still shows stay. */
describe('what a purge stops paying for', () => {
  const used = async () => (await call<{ used: number }>(env, '/v1/usage', { token })).json.used

  async function upload(text: string, type: string): Promise<string> {
    const bytes = new TextEncoder().encode(text)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const up = await call(env, `/v1/blobs/${hash}`, {
      method: 'PUT',
      token,
      raw: bytes,
      headers: { 'content-type': type },
    })
    expect(up.status).toBeLessThan(300)
    return hash
  }

  test('a file of a space purged for good', async () => {
    await call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' })
    const before = await used()
    const bytes = new TextEncoder().encode('x'.repeat(5000))
    const hash = createHash('sha256').update(bytes).digest('hex')
    await call(env, `/v2/blobs/${hash}`, {
      method: 'PUT',
      token,
      raw: bytes,
      headers: { 'content-type': 'application/octet-stream' },
    })
    await call(env, `/v2/spaces/${space}/ops`, {
      token,
      body: {
        ops: [
          {
            op: 'f1',
            t: 'create',
            id: 'file_1',
            kind: 'file',
            parent: null,
            name: 'a.bin',
            hash,
            size: 5000,
            seen: 0,
          },
        ],
      },
    })
    await call(env, `/v2/spaces/${space}/ops`, {
      token,
      body: { ops: [{ op: 'd1', t: 'delete', id: 'file_1', seen: 999 }] },
    })
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })
    expect((await call(env, `/v1/trash/spaces/${space}`, { method: 'DELETE', token })).status).toBe(
      200,
    )

    expect(await used()).toBe(before)
    expect(env.keys()).not.toContain(`blobs/${hash}`)
  })

  test('a picture of a note purged for good, and not one another note still shows', async () => {
    const gone = await upload('only in the purged note', 'image/png')
    const kept = await upload('in both notes', 'image/png')
    const id = (
      await call(env, `/v1/spaces/${space}/notes`, {
        token,
        body: {
          path: 'A.md',
          content: `![](https://nibeditor.com/i/${gone}.png) ![](https://nibeditor.com/i/${kept}.png)`,
        },
      })
    ).json.note.id
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'B.md', content: `![](https://nibeditor.com/i/${kept}.png)` },
    })
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })
    expect((await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })).status).toBe(200)

    expect((await call(env, `/i/${gone}.png`)).status).toBe(404)
    expect((await call(env, `/i/${kept}.png`)).status).toBe(200)
  })

  /** Whether one of the owner's own notes written before its pictures were shows the
   *  picture cannot be told until the nightly sweep reads it: the row stays, and so does
   *  the question, for the next sweep. */
  test('keeps a picture an unread note of its own might show, and asks again later', async () => {
    const hash = await upload('maybe somewhere else', 'image/png')
    const id = (
      await call(env, `/v1/spaces/${space}/notes`, {
        token,
        body: { path: 'A.md', content: `![](https://nibeditor.com/i/${hash}.png)` },
      })
    ).json.note.id
    const old = (
      await call(env, `/v1/spaces/${space}/notes`, {
        token,
        body: { path: 'Old.md', content: 'x' },
      })
    ).json.note.id
    env.db.prepare('update notes set front_rev = 1 where id = ?').run(old)
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })
    await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })

    expect((await call(env, `/i/${hash}.png`)).status).toBe(200)
    expect(env.db.prepare('select hash from unused_blobs').all()).toEqual([{ hash }])

    env.db.prepare('update notes set front_rev = 2 where id = ?').run(old)
    const { sweepUnused } = await import('../src/unused')
    expect(await sweepUnused(env)).toBe(1)
    expect((await call(env, `/i/${hash}.png`)).status).toBe(404)
  })

  test('a page note’s paper', async () => {
    const before = await used()
    const id = (
      await call(env, `/v1/spaces/${space}/notes`, {
        token,
        body: { path: 'L.pages', content: '{}' },
      })
    ).json.note.id
    const hash = await upload('%PDF-1.4\npurged\n%%EOF\n', 'application/pdf')
    await call(env, `/v1/notes/${id}/paper`, { method: 'PUT', token, body: { hash } })
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })
    expect((await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })).status).toBe(200)

    expect(await used()).toBe(before)
  })

  /** One sweep reads the bodies it needs once, whatever it asks about: a purge of a
   *  note with many pictures, by a writer in a space of unread notes, reads that space
   *  once and not once per picture. */
  test('reads the unread notes once for everything a sweep asks about', async () => {
    const other = await signIn(env, 'other@example.com')
    const theirs = (await call(env, '/v1/spaces', { token: other, body: { name: 'Big' } })).json
      .space.id
    const sent = await mail(() =>
      call(env, `/v1/spaces/${theirs}/share/invite`, {
        token: other,
        body: { email: 'owner@example.com', role: 'write' },
      }),
    )
    await call(env, `/v1/join/${/\/join\/([a-f0-9]+)/.exec(sent)?.[1]}`, {
      method: 'POST',
      token,
    })
    for (let at = 0; at < 260; at++) {
      env.db
        .prepare(
          `insert into notes (id, space_id, path, seq, updated_at, size, hash, front_rev)
           values (?, ?, ?, ?, 1, 5, 'h', 1)`,
        )
        .run(`old${String(at)}`, theirs, `old${String(at)}.md`, 1000 + at)
    }
    const lines: string[] = []
    for (let at = 0; at < 25; at++) {
      const hash = await upload(`picture ${String(at)}`, 'image/png')
      lines.push(`![](https://nibeditor.com/i/${hash}.png)`)
    }
    const id = (
      await call(env, `/v1/spaces/${space}/notes`, {
        token,
        body: { path: 'P.md', content: lines.join('\n') },
      })
    ).json.note.id
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })

    const bucket = env.NOTES as unknown as { get: (...asked: unknown[]) => unknown }
    const real = bucket.get.bind(bucket)
    let gets = 0
    bucket.get = (...asked: unknown[]) => {
      gets += 1
      return real(...asked)
    }
    expect((await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })).status).toBe(200)

    // One budget of bodies, and the purged note's own.
    expect(gets).toBeLessThanOrEqual(251)
  })
})
