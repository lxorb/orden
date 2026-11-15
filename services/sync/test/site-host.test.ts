import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string

const SITE = 'field.nibeditor.com'

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  const space = (await call(env, '/v1/spaces', { token, body: { name: 'Field notes' } })).json.space
    .id
  await call(env, `/v1/spaces/${space}/notes`, { token, body: { path: 'Hello.md', content: 'Hi' } })
  await call(env, `/v1/spaces/${space}/blog`, {
    method: 'PUT',
    token,
    body: { subdomain: 'field' },
  })
})

afterEach(() => env.close())

describe("a published site's own address", () => {
  test('serves the site', async () => {
    expect((await call(env, '/', { host: SITE })).status).toBe(200)
  })

  test.each([
    ['GET', '/v1/me'],
    ['POST', '/v1/auth/code'],
    ['GET', '/v2/pass/vaults'],
    ['GET', '/oauth/authorize?client_id=x'],
    ['GET', '/.well-known/oauth-authorization-server'],
    ['POST', '/mcp'],
    ['GET', '/%761/me'],
    ['POST', '/%761/auth/code'],
    ['GET', '/%762/pass/changes'],
    ['GET', '/%6fauth/authorize?client_id=x'],
    ['POST', '/%6dcp'],
  ])('answers nothing of the account at %s %s', async (method, path) => {
    const asked = await call(env, path, {
      host: SITE,
      method,
      token,
      ...(method === 'POST' ? { body: { email: 'a@b.dev' } } : {}),
    })
    expect(asked.status).toBe(404)
  })

  test('leaves the account answering on its own address', async () => {
    expect((await call(env, '/v1/me', { token })).status).toBe(200)
    expect((await call(env, '/.well-known/oauth-authorization-server')).status).toBe(200)
  })
})
