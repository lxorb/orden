/** What emptying Recently deleted leaves behind, which is nothing (#457, #467).
 *
 *  A note's id names more than its row: its room, which holds the whole document; the
 *  chat its `.chat` file opens; who it was shared with. A purge takes all of them, and
 *  an id whose row went for good is not one anybody may make something under again
 *  while anything it named is still there. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { type PullResponse, type PushResponse, seedUpdate } from '@nib/sync-core'
import { TEXT } from '@nib/rooms'
import * as Y from 'yjs'
import { sweepChats } from '../src/chats/sweep'
import { sweepLeftovers } from '../src/leftovers'
import { call, type ShareView, signIn, type TestEnv, testEnv } from './harness'
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
