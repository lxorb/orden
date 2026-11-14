import { beforeEach, describe, expect, test, vi } from 'vitest'

const server = vi.hoisted(() => ({
  answer: undefined as object | undefined,
  sent: [] as { path: string; body: unknown }[],
}))

vi.mock('../../accounts/src/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../accounts/src/client')>()),
  request: (path: string, options: { method?: string; body?: unknown } = {}) => {
    if (options.method === 'PUT') {
      server.sent.push({ path, body: options.body })
      return Promise.resolve({})
    }
    return server.answer === undefined
      ? Promise.reject(new Error('404 Not Found'))
      : Promise.resolve(server.answer)
  },
}))

const { workspace } = await import('../../workspace.svelte')
const { pulled } = await import('./synced')

const ROOT = '/space'
const PAIRS = [{ root: ROOT, spaceId: 's1' }]
const HASH = { n: 16, r: 1, p: 1, salt: 'c2FsdA==', hash: 'aGFzaA==', at: Date.now() + 60_000 }

beforeEach(() => {
  server.answer = undefined
  server.sent = []
  workspace.protection.forget(ROOT)
})

describe('protection on the account', () => {
  test('from a service older than it is left as this machine has it', async () => {
    workspace.protection.set(ROOT, `${ROOT}/Diary`, 'password')
    await expect(pulled('token', 'u1', PAIRS)).resolves.toBeUndefined()
    expect(workspace.protection.ways(ROOT)).toEqual({ Diary: 'password' })
  })

  test('is taken in, the password with it, so another device locks the same notes', async () => {
    server.answer = { password: HASH, spaces: { s1: { Diary: 'device', '': 'password' } } }
    await pulled('token', 'u1', PAIRS)
    expect(workspace.protection.ways(ROOT)).toEqual({ Diary: 'device', '': 'password' })
    expect(workspace.protection.password?.hash).toBe('aGFzaA==')
    expect(workspace.protection.locked(`${ROOT}/Plans.md`)).toBe(true)
  })

  test('never hands one account’s password to the next one signed in on the device', async () => {
    server.answer = { password: HASH, spaces: {} }
    await pulled('first', 'u1', PAIRS)
    expect(workspace.protection.password?.hash).toBe('aGFzaA==')

    server.answer = { password: null, spaces: {} }
    await pulled('second', 'u2', PAIRS)
    expect(server.sent.filter((one) => one.path === '/v1/protected/password')).toEqual([])

    const theirs = { ...HASH, salt: 'b3RoZXI=', hash: 'b3RoZXI=', at: 1 }
    server.answer = { password: theirs, spaces: {} }
    await pulled('second', 'u2', PAIRS)
    expect(workspace.protection.password?.hash).toBe('b3RoZXI=')
    expect(server.sent).toEqual([])
  })
})
