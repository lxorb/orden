import { afterEach, beforeEach, expect, test } from 'vitest'
import { call, signIn, type TestEnv, testEnv } from './harness'

interface Me {
  user?: { id: string; syncVersion?: number }
}

let env: TestEnv
let token: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'mover@example.com')
})

afterEach(() => env.close())

test('is 1 for an account nobody has flipped', async () => {
  const { status, json } = await call<Me>(env, '/v1/me', { token })

  expect(status).toBe(200)
  expect(json.user?.syncVersion).toBe(1)
})

test('is 2 for the account it was flipped for, and no other, and back again', async () => {
  const other = await signIn(env, 'stayer@example.com')
  env.db.prepare("update users set sync_version = 2 where email = 'mover@example.com'").run()

  expect((await call<Me>(env, '/v1/me', { token })).json.user?.syncVersion).toBe(2)
  expect((await call<Me>(env, '/v1/me', { token: other })).json.user?.syncVersion).toBe(1)

  env.db.prepare("update users set sync_version = 1 where email = 'mover@example.com'").run()
  expect((await call<Me>(env, '/v1/me', { token })).json.user?.syncVersion).toBe(1)
})
