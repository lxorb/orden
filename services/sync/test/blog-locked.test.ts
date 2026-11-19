import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let space: string
beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Field notes' } })).json.space.id
  await call(env, `/v1/spaces/${space}/notes`, {
    token,
    body: { path: 'Hello world.md', content: '# Hello world\n' },
  })
  await call(env, `/v1/spaces/${space}/notes`, {
    token,
    body: { path: 'Diary/Today.md', content: '# Today\n\nthe secret words\n' },
  })
  await call(env, `/v1/protected/spaces/${space}`, {
    method: 'PUT',
    token,
    body: { protected: { Diary: 'password' } },
  })
})
afterEach(() => env.close())
describe('a published space with a locked folder', () => {
  test('neither lists nor serves the locked note, and still serves the rest', async () => {
    await call(env, `/v1/spaces/${space}/blog`, {
      method: 'PUT',
      token,
      body: { subdomain: 'field' },
    })
    const index = await call(env, '/', { host: 'field.nibeditor.com' })
    expect(index.text).toContain('/hello-world')
    expect(index.text).not.toContain('/diary/today')
    const page = await call(env, '/diary/today', { host: 'field.nibeditor.com' })
    expect(page.status).toBe(404)
    expect(page.text).not.toContain('the secret words')
  })
})
