/** What emptying Recently deleted leaves behind, which is nothing (#457, #467).
 *
 *  A note's id names more than its row: its room, which holds the whole document; the
 *  chat its `.chat` file opens; who it was shared with. A purge takes all of them, and
 *  an id whose row went for good is not one anybody may make something under again
 *  while anything it named is still there. */

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { type PullResponse, type PushResponse, seedUpdate } from '@nib/sync-core'
import { TEXT } from '@nib/rooms'
import * as Y from 'yjs'
import { sweepChats } from '../src/chats/sweep'
import { sweepLeftovers } from '../src/leftovers'
import { call, mail, type ShareView, signIn, type TestEnv, testEnv } from './harness'
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
