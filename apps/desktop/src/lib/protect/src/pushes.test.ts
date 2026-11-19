import { beforeEach, describe, expect, test, vi } from 'vitest'
import '../test/storage'

const server = vi.hoisted(() => ({
  stored: {},
  puts: [] as { body: unknown; land: (answer?: unknown) => void; fail: () => void }[],
  holdGet: false,
  gets: [] as (() => void)[],
}))
vi.mock('../../accounts/src/api', () => ({
  account: { token: 'token', user: { id: 'u1' } },
  request: (_path: string, options: { method?: string; body?: unknown } = {}) => {
    if (options.method === 'PUT') {
      return new Promise((resolve, reject) => {
        const body = options.body as { protected: unknown }
        server.puts.push({
          body,
          land: (answer?: unknown) => {
            server.stored = { s1: body.protected }
            resolve(answer ?? {})
          },
          fail: () => reject(new Error('offline')),
        })
      })
    }
    const snapshot = { password: null, spaces: server.stored }
    if (server.holdGet) return new Promise((go) => server.gets.push(() => go(snapshot)))
    return Promise.resolve(snapshot)
  },
}))
vi.mock('@orden/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@orden/contracts')>()),
  syncStore: () => ({ remoteIdFor: () => 's1' }),
}))
const { protection } = await import('./protection.svelte')
const { pulled } = await import('./synced')
const ROOT = '/space'
const PAIRS = [{ root: ROOT, spaceId: 's1' }]
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((go) => setTimeout(go, 0))
}
beforeEach(async () => {
  await protection.forget(ROOT)
  server.stored = {}
  server.puts = []
  server.gets = []
  server.holdGet = false
  await pulled('token', 'u1', PAIRS)
  await settle()
})
describe('the locks a space sends the account', () => {
  test('go one push at a time, so an older one can never land last', async () => {
    protection.set(ROOT, `${ROOT}/A.md`, 'password')
    await settle()
    protection.set(ROOT, `${ROOT}/B.md`, 'password')
    await settle()
    expect(server.puts).toHaveLength(1)
    server.puts[0]?.land()
    await settle()
    expect(server.puts.map((one) => one.body)).toMatchObject([
      { protected: { 'A.md': 'password' } },
      { protected: { 'A.md': 'password', 'B.md': 'password' } },
    ])
    server.puts[1]?.land()
    await settle()
    await pulled('token', 'u1', PAIRS)
    await settle()
    expect(protection.locked(`${ROOT}/B.md`)).toBe(true)
  })
  test('stay here when a pull comes between an older push landing and the newest', async () => {
    protection.set(ROOT, `${ROOT}/Plans.md`, 'password')
    await settle()
    protection.set(ROOT, `${ROOT}/Diary.md`, 'password')
    server.puts[0]?.land()
    await settle()
    const pulling = pulled('token', 'u1', PAIRS)
    await settle()
    expect(protection.ways(ROOT)).toEqual({ 'Plans.md': 'password', 'Diary.md': 'password' })
    for (const one of server.puts.slice(1)) one.land()
    await settle()
    for (const one of server.puts.slice(1)) one.land()
    await pulling
  })
  test('are not taken back by a pull the account answered before the push landed', async () => {
    server.holdGet = true
    const pulling = pulled('token', 'u1', PAIRS)
    await settle()
    protection.set(ROOT, `${ROOT}/Diary.md`, 'password')
    await settle()
    server.puts[0]?.land()
    await settle()
    server.gets[0]?.()
    await pulling
    await settle()
    expect(protection.locked(`${ROOT}/Diary.md`)).toBe(true)
  })
  test('carry what the account last held, and take the map it merged them into', async () => {
    server.stored = { s1: { 'Plans.md': 'password' } }
    await pulled('token', 'u1', PAIRS)
    await settle()
    protection.set(ROOT, `${ROOT}/Taxes.md`, 'password')
    await settle()
    expect(server.puts.at(-1)?.body).toEqual({
      protected: { 'Plans.md': 'password', 'Taxes.md': 'password' },
      base: { 'Plans.md': 'password' },
    })
    const merged = { 'Plans.md': 'password', 'Diary.md': 'device', 'Taxes.md': 'password' }
    server.puts.at(-1)?.land({ password: null, spaces: { s1: merged } })
    await settle()
    expect(protection.ways(ROOT)).toEqual(merged)
    protection.set(ROOT, `${ROOT}/Plans.md`, null)
    await settle()
    expect(server.puts.at(-1)?.body).toMatchObject({ base: merged })
    server.puts.at(-1)?.land()
    await settle()
  })
})
