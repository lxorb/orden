import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { AT_ONCE, freeName, purgeExpired } from '../src/sync-server/src/trash'
import { call, signIn, testEnv, type TestEnv, type TrashView } from './harness'

let env: TestEnv
let token: string
let space: string

const DAY = 24 * 60 * 60 * 1000

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')

  const created = await call(env, '/v1/spaces', { token, body: { name: 'Work' } })
  space = created.json.space.id
})

afterEach(() => env.close())

async function addNote(path: string, content: string, inSpace = space): Promise<string> {
  const response = await call(env, `/v1/spaces/${inSpace}/notes`, {
    token,
    body: { path, content },
  })
  return response.json.note.id
}

async function addSpace(name: string): Promise<string> {
  const response = await call(env, '/v1/spaces', { token, body: { name } })
  return response.json.space.id
}

function row(id: string) {
  return env.db.prepare('select * from notes where id = ?').get(id) as
    | {
        deleted: number
        deleted_at: number | null
        size: number
        hash: string
        seq: number
        path: string
      }
    | undefined
}

function spaceRow(id: string) {
  return env.db.prepare('select * from spaces where id = ?').get(id) as
    { deleted: number; deleted_at: number | null; name: string; position: number } | undefined
}

async function stored(noteId: string, inSpace = space): Promise<string | null> {
  const object = await env.NOTES.get(`spaces/${inSpace}/${noteId}`)
  return object ? await object.text() : null
}

function agedBy(days: number) {
  const at = Date.now() - days * DAY
  env.db.prepare('update notes set deleted_at = ? where deleted_at is not null').run(at)
  env.db.prepare('update spaces set deleted_at = ? where deleted_at is not null').run(at)
}

describe('deleting keeps what was deleted', () => {
  test('a note keeps its content and is stamped', async () => {
    const id = await addNote('Idea.md', '# Idea')
    const before = row(id)!

    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })

    const after = row(id)!
    expect(after.deleted).toBe(1)
    expect(after.deleted_at).toBeGreaterThan(0)
    expect(after.size).toBe(before.size)
    expect(after.hash).toBe(before.hash)
    expect(await stored(id)).toBe('# Idea')
  })

  test('other devices still learn that the note went', async () => {
    const id = await addNote('Idea.md', '# Idea')
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })

    const changes = await call(env, `/v1/spaces/${space}/changes`, { token })
    expect(
      changes.json.notes.map((note: { id: string; deleted: boolean }) => [note.id, note.deleted]),
    ).toEqual([[id, true]])
  })

  test('a space keeps its notes and is stamped', async () => {
    const id = await addNote('Idea.md', '# Idea')
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })

    expect(spaceRow(space)!.deleted).toBe(1)
    expect(spaceRow(space)!.deleted_at).toBeGreaterThan(0)
    expect(row(id)!.deleted).toBe(0)
    expect(await stored(id)).toBe('# Idea')
  })
})

describe('the listing', () => {
  test('shows deleted notes and spaces with the day they go', async () => {
    const note = await addNote('Idea.md', '# Idea')
    const other = await addSpace('Old')
    await call(env, `/v1/notes/${note}`, { method: 'DELETE', token })
    await call(env, `/v1/spaces/${other}`, { method: 'DELETE', token })

    const listed = await call<TrashView>(env, '/v1/trash', { token })
    expect(listed.status).toBe(200)
    expect(listed.json.notes).toHaveLength(1)
    expect(listed.json.notes[0]).toMatchObject({
      id: note,
      path: 'Idea.md',
      spaceId: space,
      spaceName: 'Work',
    })
    expect(listed.json.notes[0]!.purgeAt - listed.json.notes[0]!.deletedAt).toBe(14 * DAY)
    expect(listed.json.spaces).toHaveLength(1)
    expect(listed.json.spaces[0]).toMatchObject({ id: other, name: 'Old', notes: 0 })
    expect(listed.json.spaces[0]!.purgeAt - listed.json.spaces[0]!.deletedAt).toBe(14 * DAY)
  })

  test('counts the notes a deleted space holds, and does not list them on their own', async () => {
    await addNote('One.md', '1')
    await addNote('Two.md', '2')
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })

    const listed = await call<TrashView>(env, '/v1/trash', { token })
    expect(listed.json.spaces[0]!.notes).toBe(2)
    expect(listed.json.notes).toEqual([])
  })

  test('is the account’s own', async () => {
    const note = await addNote('Idea.md', '# Idea')
    await call(env, `/v1/notes/${note}`, { method: 'DELETE', token })

    const other = await signIn(env, 'other@b.dev')
    const theirs = await call<TrashView>(env, '/v1/trash', { token: other })
    expect(theirs.json).toEqual({ spaces: [], notes: [] })
  })
})

describe('restoring a note', () => {
  test('brings it back where it was, and every device hears of it', async () => {
    const id = await addNote('Idea.md', '# Idea')
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })
    const gone = row(id)!

    const restored = await call(env, `/v1/trash/notes/${id}/restore`, { method: 'POST', token })
    expect(restored.status).toBe(200)
    expect(restored.json.note).toMatchObject({ id, path: 'Idea.md', deleted: false })

    const after = row(id)!
    expect(after.deleted).toBe(0)
    expect(after.deleted_at).toBeNull()
    expect(after.seq).toBeGreaterThan(gone.seq)
    expect(await stored(id)).toBe('# Idea')

    const changes = await call(env, `/v1/spaces/${space}/changes?since=${gone.seq}`, { token })
    expect(
      changes.json.notes.map((note: { id: string; deleted: boolean }) => [note.id, note.deleted]),
    ).toEqual([[id, false]])
    expect((await call<TrashView>(env, '/v1/trash', { token })).json.notes).toEqual([])
  })

  test('takes the next free name when its place is taken', async () => {
    const id = await addNote('notes/Idea.md', 'old')
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })
    await addNote('notes/Idea.md', 'new')
    await addNote('notes/Idea 2.md', 'newer')

    const restored = await call(env, `/v1/trash/notes/${id}/restore`, { method: 'POST', token })
    expect(restored.json.note.path).toBe('notes/Idea 3.md')
  })

  test('waits for its space', async () => {
    const id = await addNote('Idea.md', '# Idea')
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })

    const refused = await call(env, `/v1/trash/notes/${id}/restore`, { method: 'POST', token })
    expect(refused.status).toBe(409)
  })

  test('is not for another account', async () => {
    const id = await addNote('Idea.md', '# Idea')
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })

    const other = await signIn(env, 'other@b.dev')
    const refused = await call(env, `/v1/trash/notes/${id}/restore`, {
      method: 'POST',
      token: other,
    })
    expect(refused.status).toBe(404)
  })
})

describe('restoring a space', () => {
  test('brings it back at the end of the rail, notes and all', async () => {
    const id = await addNote('Idea.md', '# Idea')
    const other = await addSpace('Second')
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })

    const restored = await call(env, `/v1/trash/spaces/${space}/restore`, { method: 'POST', token })
    expect(restored.status).toBe(200)
    expect(restored.json.space).toMatchObject({ id: space, name: 'Work' })

    const listed = await call(env, '/v1/spaces', { token })
    expect(listed.json.spaces.map((one) => one.name)).toEqual(['Notes', 'Second', 'Work'])
    expect(listed.json.spaces.map((one) => one.id)).toContain(other)
    expect(listed.json.deleted).toEqual([])
    expect(row(id)!.deleted).toBe(0)
    expect(spaceRow(space)!.deleted_at).toBeNull()
  })

  test('takes the next free name when its name is taken', async () => {
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })
    await addSpace('Work')

    const restored = await call(env, `/v1/trash/spaces/${space}/restore`, { method: 'POST', token })
    expect(restored.json.space.name).toBe('Work 2')
  })

  test('comes back unpublished', async () => {
    await call(env, `/v1/spaces/${space}/blog`, {
      token,
      method: 'PUT',
      body: { subdomain: 'mine' },
    })
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })

    const restored = await call(env, `/v1/trash/spaces/${space}/restore`, { method: 'POST', token })
    expect(restored.json.space.blog.enabled).toBe(false)
    expect(restored.json.space.blog.subdomain).toBeNull()
  })
})

describe('how many spaces one account keeps', () => {
  function fill(upTo: number) {
    const owner = env.db.prepare('select user_id from spaces where id = ?').get(space) as {
      user_id: string
    }
    const insert = env.db.prepare(
      `insert into spaces (id, user_id, name, position, created_at, updated_at)
       values (?1, ?2, ?1, 0, 0, 0)`,
    )
    const held = (
      env.db
        .prepare('select count(*) as n from spaces where user_id = ? and deleted = 0')
        .get(owner.user_id) as { n: number }
    ).n
    for (let at = held; at < upTo; at++) insert.run(`filler-${at}`, owner.user_id)
  }

  test('stops at as many as the rail lists, so a new one never drops out of sight', async () => {
    fill(500)
    const refused = await call(env, '/v1/spaces', { token, body: { name: 'One more' } })
    expect(refused.status).toBe(409)

    const listed = await call(env, '/v1/spaces', { token })
    expect(listed.json.spaces).toHaveLength(500)
  })

  test('holds when another space is made at the same moment', async () => {
    fill(499)
    env.justBefore(/insert into spaces/, () =>
      env.db
        .prepare(
          `insert into spaces (id, user_id, name, position, created_at, updated_at)
           select 'quicker', user_id, 'Quicker', 0, 0, 0 from spaces where id = ?`,
        )
        .run(space),
    )

    expect((await call(env, '/v1/spaces', { token, body: { name: 'One more' } })).status).toBe(409)
  })

  test('counts a space brought back from the trash', async () => {
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })
    fill(500)

    const restored = await call(env, `/v1/trash/spaces/${space}/restore`, { method: 'POST', token })
    expect(restored.status).toBe(409)
    expect(spaceRow(space)!.deleted).toBe(1)
  })
})

describe('purging', () => {
  test('a note now: content gone, tombstone kept, no longer listed', async () => {
    const id = await addNote('Idea.md', '# Idea')
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })

    const purged = await call(env, `/v1/trash/notes/${id}`, { method: 'DELETE', token })
    expect(purged.status).toBe(200)
    expect(await stored(id)).toBeNull()
    expect(row(id)).toMatchObject({ deleted: 1, deleted_at: null, size: 0, hash: '' })
    expect((await call<TrashView>(env, '/v1/trash', { token })).json.notes).toEqual([])
    expect(
      (await call(env, `/v1/trash/notes/${id}/restore`, { method: 'POST', token })).status,
    ).toBe(404)
  })

  test('a space now: notes gone, marker kept', async () => {
    const id = await addNote('Idea.md', '# Idea')
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })

    await call(env, `/v1/trash/spaces/${space}`, { method: 'DELETE', token })
    expect(await stored(id)).toBeNull()
    expect(row(id)).toBeUndefined()
    expect(spaceRow(space)).toMatchObject({ deleted: 1, deleted_at: null })
    expect((await call(env, '/v1/spaces', { token })).json.deleted).toEqual([space])
  })

  test('a space now keeps no words of its notes to search by', async () => {
    const id = await addNote('Secret.md', 'my bank pin is 4711')
    expect(env.db.prepare('select 1 from note_search where note_id = ?').all(id)).toHaveLength(1)
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })

    await call(env, `/v1/trash/spaces/${space}`, { method: 'DELETE', token })
    expect(env.db.prepare('select 1 from note_search where note_id = ?').all(id)).toEqual([])
  })

  test('by age: nothing before 14 days, everything after', async () => {
    const note = await addNote('Idea.md', '# Idea')
    const other = await addSpace('Old')
    await call(env, `/v1/notes/${note}`, { method: 'DELETE', token })
    await call(env, `/v1/spaces/${other}`, { method: 'DELETE', token })

    agedBy(13)
    expect(await purgeExpired(env, Date.now())).toEqual({ notes: 0, spaces: 0 })
    expect(await stored(note)).toBe('# Idea')

    agedBy(15)
    expect(await purgeExpired(env, Date.now())).toEqual({ notes: 1, spaces: 1 })
    expect(await stored(note)).toBeNull()
    expect(spaceRow(other)).toMatchObject({ deleted: 1, deleted_at: null })
    expect((await call<TrashView>(env, '/v1/trash', { token })).json).toEqual({
      spaces: [],
      notes: [],
    })
  })

  test('a space larger than one batch leaves nothing orphaned', async () => {
    for (let at = 0; at <= AT_ONCE; at++) {
      const id = `note-${at}`
      env.db
        .prepare(
          `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash)
           values (?, ?, ?, ?, 1, ?, 0, 1, 'h')`,
        )
        .run(id, space, `${at}.md`, at + 100, Date.now())
      await env.NOTES.put(`spaces/${space}/${id}`, 'x')
    }

    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })
    await call(env, `/v1/trash/spaces/${space}`, { method: 'DELETE', token })

    const left = env.db.prepare('select id from notes where space_id = ?').all(space) as {
      id: string
    }[]
    expect(left).toHaveLength(1)
    for (const one of left) expect(await stored(one.id)).not.toBeNull()
    expect(spaceRow(space)?.deleted_at).not.toBeNull()

    await call(env, `/v1/trash/spaces/${space}`, { method: 'DELETE', token })
    expect(env.db.prepare('select id from notes where space_id = ?').all(space)).toEqual([])
    expect(spaceRow(space)).toMatchObject({ deleted: 1, deleted_at: null })
  })

  test('everything at once, but only one’s own', async () => {
    const mine = await addNote('Idea.md', '# Idea')
    await call(env, `/v1/notes/${mine}`, { method: 'DELETE', token })

    const other = await signIn(env, 'other@b.dev')
    const theirSpace = (await call(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } }))
      .json.space.id
    const theirs = (
      await call(env, `/v1/spaces/${theirSpace}/notes`, {
        token: other,
        body: { path: 'T.md', content: 't' },
      })
    ).json.note.id
    await call(env, `/v1/notes/${theirs}`, { method: 'DELETE', token: other })

    await call(env, '/v1/trash', { method: 'DELETE', token })
    expect(await stored(mine)).toBeNull()
    expect(await stored(theirs, theirSpace)).toBe('t')
    expect((await call<TrashView>(env, '/v1/trash', { token: other })).json.notes).toHaveLength(1)
  })
})

describe('the numbering', () => {
  test('for names', () => {
    expect(freeName(new Set(), 'Work')).toBe('Work')
    expect(freeName(new Set(['Work']), 'Work')).toBe('Work 2')
    expect(freeName(new Set(['Work', 'Work 2']), 'Work')).toBe('Work 3')
  })
})
