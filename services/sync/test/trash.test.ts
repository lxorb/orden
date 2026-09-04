import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { freeName, freePath, purgeExpired } from '../src/trash'
import { call, signIn, testEnv, type TestEnv } from './harness'

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
  const response = await call(env, `/v1/spaces/${inSpace}/notes`, { token, body: { path, content } })
  return response.json.note.id
}

async function addSpace(name: string): Promise<string> {
  const response = await call(env, '/v1/spaces', { token, body: { name } })
  return response.json.space.id
}

function row(id: string) {
  return env.db.prepare('select * from notes where id = ?').get(id) as
    | { deleted: number; deleted_at: number | null; size: number; hash: string; seq: number; path: string }
    | undefined
}

function spaceRow(id: string) {
  return env.db.prepare('select * from spaces where id = ?').get(id) as
    | { deleted: number; deleted_at: number | null; name: string; position: number }
    | undefined
}

async function stored(noteId: string, inSpace = space): Promise<string | null> {
  const object = await env.NOTES.get(`spaces/${inSpace}/${noteId}`)
  return object ? await object.text() : null
}

/** Moves a deletion back in time, the way waiting would. */
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
    expect(changes.json.notes.map((note: { id: string; deleted: boolean }) => [note.id, note.deleted])).toEqual([
      [id, true],
    ])
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

    const listed = await call(env, '/v1/trash', { token })
    expect(listed.status).toBe(200)
    expect(listed.json.notes).toHaveLength(1)
    expect(listed.json.notes[0]).toMatchObject({ id: note, path: 'Idea.md', spaceId: space, spaceName: 'Work' })
    expect(listed.json.notes[0].purgeAt - listed.json.notes[0].deletedAt).toBe(14 * DAY)
    expect(listed.json.spaces).toHaveLength(1)
    expect(listed.json.spaces[0]).toMatchObject({ id: other, name: 'Old', notes: 0 })
    expect(listed.json.spaces[0].purgeAt - listed.json.spaces[0].deletedAt).toBe(14 * DAY)
  })

  test('counts the notes a deleted space holds, and does not list them on their own', async () => {
    await addNote('One.md', '1')
    await addNote('Two.md', '2')
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })

    const listed = await call(env, '/v1/trash', { token })
    expect(listed.json.spaces[0].notes).toBe(2)
    expect(listed.json.notes).toEqual([])
  })

  test('is the account’s own', async () => {
    const note = await addNote('Idea.md', '# Idea')
    await call(env, `/v1/notes/${note}`, { method: 'DELETE', token })

    const other = await signIn(env, 'other@b.dev')
    const theirs = await call(env, '/v1/trash', { token: other })
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
    expect(changes.json.notes.map((note: { id: string; deleted: boolean }) => [note.id, note.deleted])).toEqual([
      [id, false],
    ])
    expect((await call(env, '/v1/trash', { token })).json.notes).toEqual([])
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
    const refused = await call(env, `/v1/trash/notes/${id}/restore`, { method: 'POST', token: other })
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
    expect(listed.json.spaces.map((one: { id: string }) => one.id)).toEqual([other, space])
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
    await call(env, `/v1/spaces/${space}/blog`, { token, method: 'PUT', body: { subdomain: 'mine' } })
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })

    const restored = await call(env, `/v1/trash/spaces/${space}/restore`, { method: 'POST', token })
    expect(restored.json.space.blog.enabled).toBe(false)
    expect(restored.json.space.blog.subdomain).toBeNull()
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
    expect((await call(env, '/v1/trash', { token })).json.notes).toEqual([])
    expect((await call(env, `/v1/trash/notes/${id}/restore`, { method: 'POST', token })).status).toBe(404)
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
    expect((await call(env, '/v1/trash', { token })).json).toEqual({ spaces: [], notes: [] })
  })

  test('everything at once, but only one’s own', async () => {
    const mine = await addNote('Idea.md', '# Idea')
    await call(env, `/v1/notes/${mine}`, { method: 'DELETE', token })

    const other = await signIn(env, 'other@b.dev')
    const theirSpace = (await call(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })).json.space.id
    const theirs = (
      await call(env, `/v1/spaces/${theirSpace}/notes`, { token: other, body: { path: 'T.md', content: 't' } })
    ).json.note.id
    await call(env, `/v1/notes/${theirs}`, { method: 'DELETE', token: other })

    await call(env, '/v1/trash', { method: 'DELETE', token })
    expect(await stored(mine)).toBeNull()
    expect(await stored(theirs, theirSpace)).toBe('t')
    expect((await call(env, '/v1/trash', { token: other })).json.notes).toHaveLength(1)
  })
})

describe('the numbering', () => {
  test('for names', () => {
    expect(freeName(new Set(), 'Work')).toBe('Work')
    expect(freeName(new Set(['Work']), 'Work')).toBe('Work 2')
    expect(freeName(new Set(['Work', 'Work 2']), 'Work')).toBe('Work 3')
  })

  test('for paths keeps the folder and the extension', () => {
    expect(freePath(new Set(['a/Idea.md']), 'a/Idea.md')).toBe('a/Idea 2.md')
    expect(freePath(new Set(['Idea']), 'Idea')).toBe('Idea 2')
    expect(freePath(new Set(['.hidden']), '.hidden')).toBe('.hidden 2')
  })
})
