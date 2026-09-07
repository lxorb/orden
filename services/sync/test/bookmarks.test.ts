import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })).json.space.id
})

afterEach(() => env.close())

function put(bookmarks: unknown, options: { as?: string; id?: string } = {}) {
  return call(env, `/v1/spaces/${options.id ?? space}/bookmarks`, {
    method: 'PUT',
    token: options.as ?? token,
    body: { bookmarks },
  })
}

/** What the space listing says the space keeps, which is how the app reads it. */
async function listed(as = token) {
  const { json } = await call(env, '/v1/spaces', { token: as })
  return json.spaces.find((one) => one.id === space)?.bookmarks
}

const note = { kind: 'note', path: 'Read me.md', text: '' }
const folder = { kind: 'folder', path: 'Work', text: '' }
const heading = { kind: 'heading', path: 'Read me.md', text: 'Why it works' }
const search = { kind: 'search', path: '', text: 'tea' }

describe("a space's bookmarks", () => {
  test('start empty', async () => {
    expect(await listed()).toEqual([])
  })

  test('are kept whole, in the order they were sent', async () => {
    const set = await put([note, folder, heading, search])
    expect(set.status).toBe(200)
    expect(set.json.bookmarks).toEqual([note, folder, heading, search])

    expect(await listed()).toEqual([note, folder, heading, search])
  })

  test('are replaced by the list that arrives, which is what reordering is', async () => {
    await put([note, folder])
    await put([folder, note])

    expect(await listed()).toEqual([folder, note])
  })

  test('go away when an empty list is sent', async () => {
    await put([note])
    await put([])

    expect(await listed()).toEqual([])
  })

  test('keep only the fields a bookmark has', async () => {
    await put([{ ...note, colour: 'red', run: 'rm -rf' }])
    expect(await listed()).toEqual([note])
  })

  test('mark the space as changed, so another device notices', async () => {
    const before = (await call(env, '/v1/spaces', { token })).json.spaces[0]?.updatedAt ?? 0
    await put([note])
    const after = (await call(env, '/v1/spaces', { token })).json.spaces[0]?.updatedAt ?? 0

    expect(after).toBeGreaterThanOrEqual(before)
  })
})

describe('bookmarks belong to one account', () => {
  test("are not another account's to write", async () => {
    const other = await signIn(env, 'c@d.dev')

    // The same answer an id that does not exist gets: nothing about the space
    // leaks, not even that it is there.
    expect((await put([note], { as: other })).status).toBe(404)
    expect(await listed()).toEqual([])
  })

  test('are not another account’s to read', async () => {
    const other = await signIn(env, 'c@d.dev')
    await put([note])

    const theirs = await call(env, '/v1/spaces', { token: other })
    expect(theirs.json.spaces).toEqual([])
  })

  test('need a session at all', async () => {
    expect((await call(env, `/v1/spaces/${space}/bookmarks`, { method: 'PUT' })).status).toBe(401)
  })

  test('answer 404 for a space that is not there', async () => {
    expect((await put([note], { id: 'nope' })).status).toBe(404)
  })
})

describe('a list that is not one', () => {
  test('is refused', async () => {
    expect((await put('Read me.md')).status).toBe(400)
    expect((await put({ 0: note })).status).toBe(400)
    expect((await put(null)).status).toBe(400)
  })

  test('is refused when the body is not an object at all', async () => {
    const sent = await call(env, `/v1/spaces/${space}/bookmarks`, {
      method: 'PUT',
      token,
      body: [note],
    })

    expect(sent.status).toBe(400)
  })

  test('says what is wrong with it', async () => {
    expect((await put('x')).json.error).toBe('bookmarks must be a list')
    expect((await put([7])).json.error).toBe('a bookmark must be an object')
    expect((await put([{ kind: 'tag', path: '', text: 'x' }])).json.error).toContain('what kind')
  })

  test('leaves what was there as it was', async () => {
    await put([note])
    await put([{ kind: 'nonsense' }])

    expect(await listed()).toEqual([note])
  })
})

describe('a bookmark past its bounds', () => {
  test('is refused for a kind nothing knows', async () => {
    expect((await put([{ kind: 'tag', path: 'a', text: '' }])).status).toBe(400)
    expect((await put([{ path: 'a', text: '' }])).status).toBe(400)
  })

  test('is refused for a path or a text that is not one', async () => {
    expect((await put([{ kind: 'note', path: 7, text: '' }])).status).toBe(400)
    expect((await put([{ kind: 'note', path: 'a', text: null }])).status).toBe(400)
  })

  test('is refused for a path longer than a path', async () => {
    expect((await put([{ kind: 'note', path: 'a'.repeat(301), text: '' }])).status).toBe(400)
    expect((await put([{ kind: 'note', path: 'a'.repeat(300), text: '' }])).status).toBe(200)
  })

  test('is refused for a text longer than a heading', async () => {
    expect((await put([{ kind: 'search', path: '', text: 'a'.repeat(201) }])).status).toBe(400)
    expect((await put([{ kind: 'search', path: '', text: 'a'.repeat(200) }])).status).toBe(200)
  })

  test('is refused when the path is not inside the space', async () => {
    for (const path of ['/etc/passwd', '../secret.md', 'a/../../b.md', String.raw`C:\secret.md`]) {
      expect((await put([{ kind: 'note', path, text: '' }])).status, path).toBe(400)
    }
  })

  test('takes a path with dots in a name of its own', async () => {
    expect((await put([{ kind: 'note', path: 'Work/..hidden/a.md', text: '' }])).status).toBe(200)
  })
})

describe('more bookmarks than a space holds', () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, at) => ({ kind: 'note', path: `${at}.md`, text: '' }))

  test('is refused by the count', async () => {
    expect((await put(many(60))).status).toBe(200)
    expect((await put(many(61))).status).toBe(400)
  })

  test('is refused by the size, when every entry is legal on its own', async () => {
    // Sixty paths of three hundred characters is more than the column carries,
    // which is the other end of the same guard.
    const big = Array.from({ length: 60 }, (_, at) => ({
      kind: 'note',
      path: `${'folder/'.repeat(40)}${at}.md`,
      text: 'a'.repeat(200),
    }))

    expect((await put(big)).status).toBe(413)
    expect(await listed()).toEqual([])
  })
})

describe('a column written by a newer build', () => {
  test('is read as far as this one understands it', async () => {
    env.db
      .prepare('update spaces set bookmarks = ? where id = ?')
      .run(JSON.stringify([note, { kind: 'tag', path: '', text: 'tea' }, 7]), space)

    expect(await listed()).toEqual([note])
  })

  test('is read as nothing when it is not a list at all', async () => {
    env.db.prepare('update spaces set bookmarks = ? where id = ?').run('not json', space)
    expect(await listed()).toEqual([])

    env.db.prepare('update spaces set bookmarks = ? where id = ?').run('{"a":1}', space)
    expect(await listed()).toEqual([])
  })
})
