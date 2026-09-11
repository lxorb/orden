import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readExcluded } from '../src/spaces/excluded'
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

function put(excluded: unknown) {
  return call(env, `/v1/spaces/${space}/excluded`, { method: 'PUT', token, body: { excluded } })
}

/** What the space listing says is left out, which is how the app reads it. */
async function listed() {
  const { json } = await call(env, '/v1/spaces', { token })
  return json.spaces.find((one) => one.id === space)?.excluded
}

/** The column as somebody else's build left it, which no route would write. */
function column(raw: string) {
  env.db.prepare('update spaces set excluded = ? where id = ?').run(raw, space)
}

const LEFT_OUT = ['Archive', 'Work/Old plan.md']

describe('what a space leaves out', () => {
  test('starts as nothing', async () => {
    expect(await listed()).toEqual([])
  })

  test('is kept whole, and rides the space listing', async () => {
    const set = await put(LEFT_OUT)
    expect(set.status).toBe(200)
    expect(set.json.excluded).toEqual(LEFT_OUT)

    expect(await listed()).toEqual(LEFT_OUT)
  })

  test('is replaced by what arrives, which is how a path is taken back', async () => {
    await put(LEFT_OUT)
    await put(['Archive'])

    expect(await listed()).toEqual(['Archive'])
  })

  test('marks the space as changed, so another device notices', async () => {
    const before = (await call(env, '/v1/spaces', { token })).json.spaces[0]?.updatedAt ?? 0
    await put(LEFT_OUT)
    const after = (await call(env, '/v1/spaces', { token })).json.spaces[0]?.updatedAt ?? 0

    expect(after).toBeGreaterThanOrEqual(before)
  })
})

describe('what may be in it', () => {
  test('is a list, and never an object or a word', async () => {
    expect((await put({})).status).toBe(400)
    expect((await put('Archive')).status).toBe(400)
  })

  test('and a path inside the space, never one on somebody else s disk', async () => {
    const set = await put([
      'Archive',
      '/etc/passwd',
      'C:\\notes',
      '../outside',
      'fine/../also fine',
      '',
      7,
    ])

    expect(set.json.excluded).toEqual(['Archive'])
  })

  test('and each path once, in the order it arrived', async () => {
    const set = await put(['b', 'a', 'b'])

    expect(set.json.excluded).toEqual(['b', 'a'])
  })

  test('and more paths than a space leaves out is refused, so nothing is lost', async () => {
    const many = Array.from({ length: 201 }, (_one, index) => `note-${index}.md`)

    expect((await put(many)).status).toBe(400)
    expect((await put(many.slice(0, 200))).status).toBe(200)
  })

  test('and a path longer than a path is dropped rather than refused', async () => {
    const set = await put(['Archive', 'a'.repeat(301)])

    expect(set.json.excluded).toEqual(['Archive'])
  })
})

/** The column is written whole by clients, so a newer app may have left something
 *  in it this build has never heard of. Read, not trusted. */
describe('reading the column back', () => {
  test('keeps the paths and leaves the rest', async () => {
    column('["Archive",{"glob":"*.tmp"},"Work"]')

    expect(await listed()).toEqual(['Archive', 'Work'])
  })

  test('and answers with nothing at all for a column that is not a list', () => {
    expect(readExcluded('not json')).toEqual([])
    expect(readExcluded('{}')).toEqual([])
    expect(readExcluded('null')).toEqual([])
  })
})
