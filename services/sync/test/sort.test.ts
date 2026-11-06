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

function put(sort: unknown) {
  return call(env, `/v1/spaces/${space}/sort`, { method: 'PUT', token, body: { sort } })
}

async function listed() {
  const { json } = await call(env, '/v1/spaces', { token })
  return json.spaces.find((one: { id: string }) => one.id === space)?.sort
}

describe('the order a space is read in', () => {
  test('is by name until somebody chooses', async () => {
    expect(await listed()).toBe('name')
  })

  test('is kept on the space, and rides the space listing', async () => {
    const set = await put('manual')
    expect(set.status).toBe(200)
    expect(await listed()).toBe('manual')

    expect((await put('modified-desc')).status).toBe(200)
    expect(await listed()).toBe('modified-desc')
  })

  test('back by name is nothing written, as it was', async () => {
    await put('manual')
    await put('name')
    const raw = env.db.prepare('select sort from spaces where id = ?').get(space) as {
      sort: string
    }
    expect(raw.sort).toBe('')
    expect(await listed()).toBe('name')
  })

  test('refuses what is not one of the orders', async () => {
    for (const wrong of ['sideways', '', 3, null]) {
      expect((await put(wrong)).status, String(wrong)).toBe(400)
    }
    expect(await listed()).toBe('name')
  })

  test('reads a word it has never heard of as by name', async () => {
    env.db.prepare('update spaces set sort = ? where id = ?').run('by-colour', space)
    expect(await listed()).toBe('name')
  })

  test('is written only by somebody who may write in the space', async () => {
    const other = await signIn(env, 'c@d.dev')
    const answer = await call(env, `/v1/spaces/${space}/sort`, {
      method: 'PUT',
      token: other,
      body: { sort: 'manual' },
    })
    expect(answer.status).toBe(404)
  })
})
