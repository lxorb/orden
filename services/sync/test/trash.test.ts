import { afterEach, beforeEach, describe, expect, test } from 'vitest'
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
