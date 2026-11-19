import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { live } from './sync2'

let env: TestEnv
let token: string
let alone: string[]
beforeEach(async () => {
  env = testEnv()
  live(env)
  token = await signIn(env, 'seq@example.com')
  alone = []
  watch(env)
})
afterEach(() => env.close())
function watch(on: TestEnv) {
  const db = on.DB
  const prepare = db.prepare.bind(db)
  const batch = db.batch.bind(db)
  let batching = 0
  const watched = {
    batch: async (statements: D1PreparedStatement[]) => {
      batching += 1
      try {
        return await batch(statements)
      } finally {
        batching -= 1
      }
    },
    prepare: (sql: string) => {
      const statement = prepare(sql)
      if (!/(insert into|update) space_cursor/i.test(sql)) return statement
      for (const name of ['run', 'first', 'all'] as const) {
        const real = statement[name].bind(statement) as (...args: unknown[]) => unknown
        ;(statement as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
          if (!batching) alone.push(sql.replace(/\s+/g, ' ').trim())
          return real(...args)
        }
      }
      return statement
    },
  }
  on.DB = new Proxy(db, {
    get: (target, key) =>
      key in watched ? watched[key as keyof typeof watched] : (Reflect.get(target, key) as unknown),
  })
}
async function newSpace(name: string, prepared: boolean): Promise<string> {
  const space = (await call(env, '/v1/spaces', { token, body: { name } })).json.space.id
  if (prepared) await call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' })
  return space
}
function numbered(space: string) {
  const rows = env.db.prepare('select seq from notes where space_id = ?1').all(space) as {
    seq: number
  }[]
  const next = (
    env.db.prepare('select next from space_cursor where space_id = ?').get(space) as {
      next: number
    }
  ).next
  return { seqs: rows.map((one) => one.seq), next }
}
describe('the cursor of a space', () => {
  test('moves with the row in a v1 space: a note made, saved, deleted and put back', async () => {
    const space = await newSpace('One', false)
    const made = await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'a.md', content: 'one' },
    })
    const id = made.json.note.id
    const saved = await call(env, `/v1/notes/${id}`, {
      method: 'PUT',
      token,
      body: { content: 'two', version: made.json.note.version },
    })
    expect(saved.status).toBe(200)
    expect((await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })).status).toBe(200)
    expect((await call(env, `/v1/trash/notes/${id}/restore`, { method: 'POST', token })).status).toBe(200)
    expect(alone).toEqual([])
    const { seqs, next } = numbered(space)
    expect(seqs).toHaveLength(1)
    expect(Math.max(...seqs)).toBe(next - 1)
  })
  test("stays put when a space's settings are written (#2183)", async () => {
    const space = await newSpace('Settings', true)
    await call(env, `/v1/spaces/${space}/notes`, { token, body: { path: 'a.md', content: 'one' } })
    const before = numbered(space).next
    const writes: [string, Record<string, unknown>][] = [
      ['bookmarks', { bookmarks: [{ kind: 'note', path: 'a.md', text: '' }] }],
      ['icons', { icons: { Work: 'Folder' } }],
      ['arranged', { arranged: { '': ['a.md'] } }],
      ['graph', { graph: { arrows: true } }],
      ['excluded', { excluded: ['Work'] }],
    ]
    for (const [route, body] of writes) {
      const said = await call(env, `/v1/spaces/${space}/${route}`, { method: 'PUT', token, body })
      expect(said.status).toBe(200)
    }
    expect(numbered(space).next).toBe(before)
  })
  test('moves with the row when a file is replaced (sync v2)', async () => {
    const space = await newSpace('Two', true)
    const bytes = (seed: number) => Uint8Array.from({ length: 64 }, (_, at) => (at + seed) % 251)
    const hashOf = async (data: Uint8Array) =>
      [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
    const [first, second] = [bytes(1), bytes(2)]
    for (const data of [first, second]) {
      await call(env, `/v2/blobs/${await hashOf(data)}`, { method: 'PUT', token, raw: data })
    }
    await call(env, `/v2/spaces/${space}/ops`, {
      token,
      body: {
        ops: [
          {
            op: 'op-1',
            t: 'create',
            id: 'file-1',
            kind: 'file',
            parent: null,
            name: 'a.bin',
            hash: await hashOf(first),
            seen: 0,
          },
        ],
      },
    })
    const replaced = await call<{ ok: boolean; seq: number }>(env, `/v2/files/${space}/file-1`, {
      method: 'PUT',
      token,
      body: { hash: await hashOf(second), base: await hashOf(first) },
    })
    expect(replaced.json.ok).toBe(true)
    expect(alone).toEqual([])
    const { seqs, next } = numbered(space)
    expect(new Set(seqs).size).toBe(seqs.length)
    expect(Math.max(...seqs)).toBe(next - 1)
    const file = env.db.prepare("select seq from notes where id = 'file-1'").get() as {
      seq: number
    }
    expect(replaced.json.seq).toBe(file.seq)
  })
})
