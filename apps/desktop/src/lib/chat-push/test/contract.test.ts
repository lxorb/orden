import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { registrar, watchPush } from '../src/api'

const SRC = join(import.meta.dirname, '..', 'src')
describe('the module stands on its own', () => {
  test('reaches no app module but accounts and the platform', () => {
    const reached = readdirSync(SRC)
      .filter((name) => !name.includes('.test.'))
      .flatMap((name) =>
        [...readFileSync(join(SRC, name), 'utf8').matchAll(/from '\.\.\/\.\.\/([a-z-]+)\/src\/api'/g)].map(
          (found) => found[1],
        ),
      )
    expect([...new Set(reached)].sort()).toEqual(['accounts', 'platform'])
  })
})
describe('where there is no phone to ask for a token', () => {
  test('nothing is watched and nothing is asked of the server', () => {
    const stop = watchPush('chat')
    expect((globalThis as { __ordenPushToken?: unknown }).__ordenPushToken).toBeUndefined()
    stop()
  })
  test('a registrar with no token registers nothing', async () => {
    let asked = 0
    await registrar({
      app: 'chat',
      token: () => Promise.resolve(''),
      me: () => ({ user: 'u', session: 's' }),
      kept: () => null,
      keep: () => undefined,
      register: () => Promise.resolve(String(++asked)),
      remove: () => Promise.resolve(),
      zone: () => '',
    }).settle()
    expect(asked).toBe(0)
  })
})
