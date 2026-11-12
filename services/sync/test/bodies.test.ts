import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'
import { listIn, MOST_BODY_BYTES, objectBody, objectIn } from '../src/sync-server/src/body'
import { MAX_NOTE_BYTES } from '../src/sync-server/src/notes'

let env: TestEnv
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })).json.space.id
})

afterEach(() => env.close())

const NOT_OBJECTS: { what: string; raw: string }[] = [
  { what: 'a list', raw: '[1, 2]' },
  { what: 'a number', raw: '7' },
  { what: 'a string', raw: '"name"' },
  { what: 'nothing parseable', raw: '{' },
]

const ROUTES: { name: string; path: () => string; method: string; older: unknown }[] = [
  {
    name: 'PUT /v1/spaces/:id/bookmarks',
    path: () => `/v1/spaces/${space}/bookmarks`,
    method: 'PUT',
    older: { bookmarks: [{ kind: 'note', path: 'Read me.md', text: '' }] },
  },
  {
    name: 'PUT /v1/spaces/:id/excluded',
    path: () => `/v1/spaces/${space}/excluded`,
    method: 'PUT',
    older: { excluded: ['Archive'] },
  },
  {
    name: 'PUT /v1/spaces/:id/files',
    path: () => `/v1/spaces/${space}/files`,
    method: 'PUT',
    older: { files: [] },
  },
  {
    name: 'PUT /v1/spaces/:id/graph',
    path: () => `/v1/spaces/${space}/graph`,
    method: 'PUT',
    older: { graph: { depth: 2 } },
  },
  {
    name: 'PUT /v1/spaces/:id/icons',
    path: () => `/v1/spaces/${space}/icons`,
    method: 'PUT',
    older: { icons: { Archive: '📦' } },
  },
  {
    name: 'PUT /v1/spaces/:id/site',
    path: () => `/v1/spaces/${space}/site`,
    method: 'PUT',
    older: { rules: { include: ['Public'] } },
  },
  {
    name: 'POST /v1/spaces/:id/site/preview',
    path: () => `/v1/spaces/${space}/site/preview`,
    method: 'POST',
    older: { rules: { otherwise: 'none' } },
  },
  {
    name: 'PATCH /v1/settings',
    path: () => '/v1/settings',
    method: 'PATCH',
    older: { keepVersions: 30 },
  },
]

describe('a body that is not an object', () => {
  for (const route of ROUTES) {
    for (const { what, raw } of NOT_OBJECTS) {
      test(`${route.name} refuses ${what}, in the words it always has`, async () => {
        const answer = await call(env, route.path(), { method: route.method, token, raw })

        expect(answer.status).toBe(400)
        expect(answer.json.error).toBe('send an object')
      })
    }
  }

  test('and a route that asks for its fields one at a time says so its own way', async () => {
    const answer = await call(env, '/v1/spaces', { method: 'POST', token, raw: '[1, 2]' })

    expect(answer.status).toBe(400)
    expect(answer.json.error).toBe('send a JSON object')
  })
})

describe('the body an older client sends', () => {
  for (const route of ROUTES) {
    test(`${route.name} still takes it`, async () => {
      const answer = await call(env, route.path(), {
        method: route.method,
        token,
        body: route.older,
      })

      expect(answer.status).toBe(200)
    })
  }
})

describe('POST /v1/mcp/token', () => {
  test('takes no body at all, and hands back a read-only token', async () => {
    const answer = await call(env, '/v1/mcp/token', { method: 'POST', token })

    expect(answer.status).toBe(200)
    expect(typeof answer.json.token).toBe('string')
  })

  test('and an unparseable body the same way, as it always has', async () => {
    const answer = await call(env, '/v1/mcp/token', { method: 'POST', token, raw: '{' })
    expect(answer.status).toBe(200)
  })

  test('but refuses a body that parsed to something else', async () => {
    const answer = await call(env, '/v1/mcp/token', { method: 'POST', token, raw: '[1, 2]' })

    expect(answer.status).toBe(400)
    expect(answer.json.error).toBe('send an object')
  })

  test('and still refuses a readOnly that is not true or false', async () => {
    const answer = await call(env, '/v1/mcp/token', {
      method: 'POST',
      token,
      body: { readOnly: 'yes' },
    })

    expect(answer.status).toBe(400)
    expect(answer.json.error).toBe('readOnly must be true or false')
  })
})

describe('what the one reading answers', () => {
  const sent = (json: () => Promise<unknown>) => ({ req: { json: json as never } })

  test('the object where a body was one', async () => {
    expect(await objectBody(sent(() => Promise.resolve({ a: 1 })))).toEqual({ a: 1 })
  })

  test('null where it parsed to something else', async () => {
    expect(await objectBody(sent(() => Promise.resolve([1, 2])))).toBeNull()
    expect(await objectBody(sent(() => Promise.resolve(7)))).toBeNull()
    expect(await objectBody(sent(() => Promise.resolve(null)))).toBeNull()
  })

  test('and undefined where there was no body to parse', async () => {
    expect(await objectBody(sent(() => Promise.reject(new Error('no body'))))).toBeUndefined()
  })

  test('and null for a body that says it is longer than one, without reading it', async () => {
    let read = 0
    const long = {
      req: {
        json: (() => {
          read += 1
          return Promise.resolve({ a: 1 })
        }) as never,
        header: (name: string) =>
          name === 'content-length' ? String(MOST_BODY_BYTES + 1) : undefined,
      },
    }

    expect(await objectBody(long)).toBeNull()
    expect(read).toBe(0)
  })

  test('while a body the routes were built for is read as it always was', async () => {
    const held = (length: number) => ({
      req: {
        json: (() => Promise.resolve({ a: 1 })) as never,
        header: (name: string) => (name === 'content-length' ? String(length) : undefined),
      },
    })

    expect(await objectBody(held(0))).toEqual({ a: 1 })
    expect(await objectBody(held(MOST_BODY_BYTES))).toEqual({ a: 1 })
  })

  test('and the ceiling leaves room for the longest note', () => {
    expect(MOST_BODY_BYTES).toBeGreaterThan(MAX_NOTE_BYTES)
  })
})

describe('what a stored column reads as', () => {
  test('a list, where it holds one', () => {
    expect(listIn('[1, "two"]')).toEqual([1, 'two'])
    expect(objectIn('{"a":1}')).toEqual({ a: 1 })
  })

  test('and nothing at all where it holds anything else', () => {
    for (const raw of ['{"a":1}', '7', '"text"', '{', '']) expect(listIn(raw)).toBeNull()
    for (const raw of ['[1]', '7', '"text"', '{', '']) expect(objectIn(raw)).toBeNull()
  })

  test('and nothing for a column that was never written', () => {
    expect(listIn(null)).toBeNull()
    expect(listIn(undefined)).toBeNull()
    expect(objectIn(null)).toBeNull()
    expect(objectIn(undefined)).toBeNull()
  })

  test('and a column that says null is not an object', () => {
    expect(objectIn('null')).toBeNull()
    expect(listIn('null')).toBeNull()
  })
})
