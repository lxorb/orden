import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
})

afterEach(() => env.close())

function patch(body: unknown, as = token) {
  return call(env, '/v1/settings', { method: 'PATCH', token: as, body })
}

describe('account settings', () => {
  test('start empty', async () => {
    const response = await call(env, '/v1/settings', { token })
    expect(response.status).toBe(200)
    expect(response.json.settings).toEqual({})
  })

  test('keep what is chosen', async () => {
    const set = await patch({ ligatures: true })
    expect(set.status).toBe(200)
    expect(set.json.settings).toEqual({ ligatures: true })

    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings).toEqual({ ligatures: true })
  })

  test('a change leaves the rest as it was', async () => {
    await patch({ ligatures: true })
    expect((await patch({})).json.settings).toEqual({ ligatures: true })
    expect((await patch({ ligatures: false })).json.settings).toEqual({ ligatures: false })
  })

  test('refuse what the app does not know', async () => {
    expect((await patch({ colour: 'red' })).status).toBe(400)
    expect((await patch({ ligatures: 'yes' })).status).toBe(400)
    expect((await patch([true])).status).toBe(400)
    expect((await call(env, '/v1/settings', { token })).json.settings).toEqual({})
  })

  test('are the account’s alone', async () => {
    const other = await signIn(env, 'c@d.dev')
    await patch({ ligatures: true })
    expect((await call(env, '/v1/settings', { token: other })).json.settings).toEqual({})
    expect((await call(env, '/v1/settings')).status).toBe(401)
  })
})
